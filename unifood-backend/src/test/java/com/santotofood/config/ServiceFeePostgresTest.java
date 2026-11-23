package com.santotofood.config;

import static org.junit.jupiter.api.Assertions.*;

import com.santotofood.adapter.out.persistence.ClientOrderPersistenceAdapter;
import com.santotofood.adapter.out.persistence.ServiceFeePersistenceAdapter;
import com.santotofood.application.port.out.ClientOrderCommandPort.NewOrder;
import com.santotofood.application.port.out.ClientOrderCommandPort.OrderingClient;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.*;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Migration 033 and the service fee adapters on a real PostgreSQL with every migration applied: the
 * month of delivered_at in America/Bogota, only DELIVERED orders, the frozen order fee, the frozen
 * and idempotent monthly close, the payment, the audit and the closed tables.
 */
@Timeout(180)
class ServiceFeePostgresTest {
  static final AtomicInteger CODES = new AtomicInteger(7000000);
  static final LocalDate OCTOBER = LocalDate.of(2026, 10, 1);
  static final LocalDate NOVEMBER = LocalDate.of(2026, 11, 1);
  static Process database;
  static JdbcTemplate jdbc;
  static TransactionTemplate tx;
  static ServiceFeePersistenceAdapter fees;
  static ClientOrderPersistenceAdapter orders;
  static UUID superAdmin;
  UUID cafe;

  @BeforeAll
  static void start() throws Exception {
    database =
        new ProcessBuilder("node", "../unifood-web/tests/helpers/backend-postgres.mjs")
            .redirectError(ProcessBuilder.Redirect.INHERIT)
            .start();
    String metadata =
        new BufferedReader(new InputStreamReader(database.getInputStream(), StandardCharsets.UTF_8))
            .readLine();
    assertNotNull(metadata, "Isolated PostgreSQL helper failed to start");
    String url = metadata.substring(metadata.indexOf("jdbc:"), metadata.lastIndexOf('"'));
    assertTrue(url.startsWith("jdbc:postgresql://127.0.0.1:"));
    var source = new DriverManagerDataSource(url, "postgres", "");
    jdbc = new JdbcTemplate(source);
    tx = new TransactionTemplate(new DataSourceTransactionManager(source));
    fees = new ServiceFeePersistenceAdapter(jdbc);
    orders = new ClientOrderPersistenceAdapter(jdbc);
    superAdmin = UUID.randomUUID();
    jdbc.update(
        "INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES (?,?,'{\"full_name\":\"Laura Global\"}'::jsonb)",
        superAdmin,
        superAdmin + "@example.invalid");
  }

  @AfterAll
  static void stop() throws Exception {
    if (database != null && database.isAlive()) {
      database.getOutputStream().write("stop\n".getBytes(StandardCharsets.UTF_8));
      database.getOutputStream().flush();
      assertTrue(database.waitFor(30, TimeUnit.SECONDS));
      assertEquals(0, database.exitValue());
    }
  }

  @BeforeEach
  void freshCafeteria() {
    cafe = cafeteria();
  }

  // ---------------------------------------------------------------- month of a fee

  @Test
  void theMonthIsTheMonthOfDeliveredAtInBogotaNotOfCreatedAt() {
    // Created 2026-10-31 23:50 and delivered 2026-11-01 00:10, both in Bogota (UTC-5).
    order(
        Instant.parse("2026-11-01T04:50:00Z"),
        "DELIVERED",
        Instant.parse("2026-11-01T05:10:00Z"),
        9300,
        300);
    // Delivered 2026-10-31 23:59 Bogota, which is already November in UTC.
    order(
        Instant.parse("2026-11-01T04:00:00Z"),
        "DELIVERED",
        Instant.parse("2026-11-01T04:59:00Z"),
        5300,
        300);
    var october = fees.summary(cafe, OCTOBER);
    var november = fees.summary(cafe, NOVEMBER);
    assertEquals(1, october.deliveredOrders());
    assertEquals(300, october.feeTotal());
    assertEquals(1, november.deliveredOrders());
    assertEquals(300, november.feeTotal());
    assertEquals(0, new BigDecimal("9000").compareTo(november.productsTotal()));
    // Any day of the month names the same month; the session time zone does not matter.
    jdbc.execute("SET TIME ZONE 'Asia/Tokyo'");
    assertEquals(1, fees.summary(cafe, LocalDate.of(2026, 11, 30)).deliveredOrders());
    jdbc.execute("SET TIME ZONE 'UTC'");
  }

  @Test
  void onlyDeliveredOrdersCount() {
    Instant at = Instant.parse("2026-10-15T17:00:00Z");
    order(at, "DELIVERED", at.plusSeconds(600), 9300, 300);
    order(at, "CANCELLED", at.plusSeconds(600), 9300, 300);
    order(at, "NOT_COLLECTED", at.plusSeconds(600), 9300, 300);
    order(at, "PENDING", null, 9300, 300);
    // Before 033 or with the flag off: fee 0, counted as an order but adds nothing.
    order(at, "DELIVERED", at.plusSeconds(900), 9000, 0);
    var summary = fees.summary(cafe, OCTOBER);
    assertEquals(2, summary.deliveredOrders());
    assertEquals(300, summary.feeTotal());
    assertEquals(0, new BigDecimal("18000").compareTo(summary.productsTotal()));
    // The cancelled and not collected keep their stored fee.
    assertEquals(
        3,
        jdbc.queryForObject(
            "SELECT count(*) FROM public.orders WHERE cafeteria_id=? AND service_fee_cop=300 AND status<>'DELIVERED'",
            Integer.class,
            cafe));
  }

  // ---------------------------------------------------------------- order snapshot

  @Test
  void theOrderInsertFreezesTheFeeAndALaterChangeDoesNotTouchIt() {
    assertEquals(300, fees.effectiveFee(cafe));
    UUID user = client();
    var client =
        jdbc.queryForObject(
            "SELECT id, full_name, institution_id, client_type::text AS t, institutional_code FROM public.clients WHERE user_id=?",
            (row, n) ->
                new OrderingClient(
                    row.getObject("id", UUID.class),
                    row.getString("full_name"),
                    row.getObject("institution_id", UUID.class),
                    row.getString("t"),
                    row.getString("institutional_code")),
            user);
    UUID id = UUID.randomUUID();
    int fee = tx.execute(status -> fees.lockEffectiveFee(cafe));
    orders.insertOrder(
        new NewOrder(
            id,
            cafe,
            client,
            new BigDecimal("13300.00"),
            null,
            null,
            "key-" + UUID.randomUUID().toString().replace("-", ""),
            "a".repeat(64),
            fee));
    var stored = orders.findOrder(id).orElseThrow();
    assertEquals(300, stored.serviceFeeCop());
    assertEquals(0, new BigDecimal("13000").compareTo(stored.productsSubtotal()));

    jdbc.update("UPDATE public.service_fee_settings SET fee_cop=500, version=version+1");
    try {
      assertEquals(500, fees.effectiveFee(cafe));
      assertEquals(300, orders.findOrder(id).orElseThrow().serviceFeeCop());
      // Nobody rewrites it, not even manual SQL.
      var refused =
          assertThrows(
              DataIntegrityViolationException.class,
              () -> jdbc.update("UPDATE public.orders SET service_fee_cop=500 WHERE id=?", id));
      assertTrue(refused.getMessage().contains("The service fee of an order is immutable"));
      // A worker transition that leaves it alone is fine.
      jdbc.update("UPDATE public.orders SET status='PREPARING' WHERE id=?", id);
    } finally {
      jdbc.update("UPDATE public.service_fee_settings SET fee_cop=300, version=version+1");
    }
  }

  @Test
  void theChecksBoundTheFee() {
    assertThrows(
        DataIntegrityViolationException.class,
        () -> jdbc.update("UPDATE public.service_fee_settings SET fee_cop=2001"));
    assertThrows(
        DataIntegrityViolationException.class,
        () -> jdbc.update("UPDATE public.service_fee_settings SET fee_cop=-1"));
    // More than the order total is impossible.
    assertThrows(
        DataIntegrityViolationException.class,
        () -> order(Instant.parse("2026-10-15T17:00:00Z"), "PENDING", null, 200, 300));
    fees.lockCafeteriaFee(cafe);
    assertThrows(
        DataIntegrityViolationException.class,
        () ->
            jdbc.update(
                "UPDATE public.cafeteria_service_fee SET fee_cop=5000 WHERE cafeteria_id=?", cafe));
  }

  // ---------------------------------------------------------------- per cafeteria value

  @Test
  void aCafeteriaValueOverridesTheGeneralOneAndZeroMeansNoFee() {
    var own = tx.execute(status -> fees.lockCafeteriaFee(cafe)).orElseThrow();
    assertNull(own.feeCop());
    // Creating the row with NULL is not a change: no audit.
    assertEquals(0, audits("CAFETERIA_FEE"));
    tx.executeWithoutResult(
        status -> {
          fees.setAuditActor(superAdmin);
          assertTrue(fees.updateCafeteriaFee(cafe, 0, 0, Instant.now(), superAdmin));
        });
    assertEquals(0, fees.effectiveFee(cafe));
    tx.executeWithoutResult(
        status -> assertFalse(fees.updateCafeteriaFee(cafe, 100, 0, Instant.now(), superAdmin)));
    tx.executeWithoutResult(
        status -> {
          fees.setAuditActor(superAdmin);
          assertTrue(fees.updateCafeteriaFee(cafe, null, 1, Instant.now(), superAdmin));
        });
    assertEquals(300, fees.effectiveFee(cafe));
    assertEquals(2, audits("CAFETERIA_FEE"));
    var entries = fees.audit(100);
    var last =
        entries.stream()
            .filter(e -> e.action().equals("CAFETERIA_FEE") && cafe.equals(e.cafeteriaId()))
            .findFirst()
            .orElseThrow();
    assertEquals("API", last.source());
    assertEquals("Laura Global", last.changedByName());
    assertEquals(0, ((Number) last.oldValue().get("feeCop")).intValue());
    assertNull(last.newValue().get("feeCop"));
  }

  // ---------------------------------------------------------------- settlements

  @Test
  void closingFreezesTheMonthOnceAndAClosedMonthIsNeverRecalculated() {
    Instant at = Instant.parse("2026-10-20T17:00:00Z");
    order(at, "DELIVERED", at.plusSeconds(600), 9300, 300);
    order(at, "DELIVERED", at.plusSeconds(700), 6300, 300);
    assertTrue(close(cafe, OCTOBER));
    assertFalse(close(cafe, OCTOBER), "a second close writes nothing");
    assertEquals(
        1,
        jdbc.queryForObject(
            "SELECT count(*) FROM public.service_fee_settlements WHERE cafeteria_id=?",
            Integer.class,
            cafe));
    assertEquals(1, audits("MONTH_CLOSED"));
    var frozen = fees.settlement(cafe, OCTOBER).orElseThrow();
    assertEquals(2, frozen.deliveredOrders());
    assertEquals(600, frozen.feeTotal());
    assertEquals("PENDIENTE", frozen.status());

    // A late row in October changes the live sum, never the closed month.
    order(at, "DELIVERED", at.plusSeconds(800), 5300, 300);
    assertEquals(900, fees.summary(cafe, OCTOBER).feeTotal());
    assertEquals(600, fees.settlement(cafe, OCTOBER).orElseThrow().feeTotal());
    var refused =
        assertThrows(
            DataIntegrityViolationException.class,
            () ->
                jdbc.update(
                    "UPDATE public.service_fee_settlements SET fee_total=900 WHERE cafeteria_id=?",
                    cafe));
    assertTrue(refused.getMessage().contains("A closed service fee month is frozen"));
    assertThrows(
        DataIntegrityViolationException.class,
        () -> jdbc.update("DELETE FROM public.service_fee_settlements WHERE cafeteria_id=?", cafe));
  }

  @Test
  void payingMovesPendienteToPagadaOnceAndForGood() {
    assertTrue(close(cafe, OCTOBER));
    assertTrue(pay(cafe, OCTOBER, "Transferencia 123"));
    assertFalse(pay(cafe, OCTOBER, "otra"), "paying twice writes nothing");
    var paid = fees.settlement(cafe, OCTOBER).orElseThrow();
    assertEquals("PAGADA", paid.status());
    assertNotNull(paid.paidAt());
    assertEquals("Transferencia 123", paid.note());
    assertEquals(1, audits("MONTH_PAID"));
    assertThrows(
        DataIntegrityViolationException.class,
        () ->
            jdbc.update(
                "UPDATE public.service_fee_settlements SET status='PENDIENTE', paid_at=NULL WHERE cafeteria_id=?",
                cafe));
    // Not closed: nothing to pay.
    assertFalse(pay(cafe, NOVEMBER, null));
  }

  @Test
  void theAuditIsAppendOnly() {
    // Two real changes, written as manual SQL (source SQL, no author), so there are rows.
    jdbc.update("UPDATE public.service_fee_settings SET fee_cop=301");
    jdbc.update("UPDATE public.service_fee_settings SET fee_cop=300");
    assertEquals(
        "SQL",
        jdbc.queryForObject(
            "SELECT source FROM public.service_fee_audit WHERE action='GENERAL_FEE' ORDER BY id DESC LIMIT 1",
            String.class));
    assertThrows(
        DataIntegrityViolationException.class,
        () -> jdbc.update("DELETE FROM public.service_fee_audit"));
    assertThrows(
        DataIntegrityViolationException.class,
        () -> jdbc.update("UPDATE public.service_fee_audit SET source='SQL'"));
    assertThrows(
        DataIntegrityViolationException.class,
        () -> jdbc.update("DELETE FROM public.service_fee_settings"));
  }

  @Test
  void theNewTablesAndFunctionsAreClosedToTheBrowser() {
    for (String table :
        new String[] {
          "service_fee_settings",
          "cafeteria_service_fee",
          "service_fee_settlements",
          "service_fee_audit"
        })
      for (String role : new String[] {"anon", "authenticated"}) {
        assertFalse(
            jdbc.queryForObject(
                "SELECT has_table_privilege(?, ?, 'SELECT')",
                Boolean.class,
                role,
                "public." + table),
            role + " " + table);
        assertTrue(
            jdbc.queryForObject(
                "SELECT relrowsecurity FROM pg_class WHERE oid = ?::regclass",
                Boolean.class,
                "public." + table));
      }
    assertFalse(
        jdbc.queryForObject(
            "SELECT has_function_privilege('authenticated', 'public.service_fee_month_summary(uuid, date)', 'EXECUTE')",
            Boolean.class));
  }

  // ---------------------------------------------------------------- fixture

  static boolean close(UUID cafeteria, LocalDate month) {
    return Boolean.TRUE.equals(
        tx.execute(
            status -> {
              fees.setAuditActor(superAdmin);
              return fees.closeMonth(cafeteria, month, superAdmin);
            }));
  }

  static boolean pay(UUID cafeteria, LocalDate month, String note) {
    return Boolean.TRUE.equals(
        tx.execute(
            status -> {
              fees.setAuditActor(superAdmin);
              return fees.markPaid(cafeteria, month, Instant.now(), superAdmin, note);
            }));
  }

  int audits(String action) {
    return jdbc.queryForObject(
        "SELECT count(*) FROM public.service_fee_audit WHERE action=? AND cafeteria_id=?",
        Integer.class,
        action,
        cafe);
  }

  static UUID cafeteria() {
    UUID site = UUID.randomUUID();
    UUID cafeteria = UUID.randomUUID();
    jdbc.update(
        "INSERT INTO public.sites(id,name,city,institution_id) SELECT ?,'Sede '||?,'Villavicencio',id FROM public.institutions WHERE email_domain='ustavillavo.edu.co'",
        site,
        site.toString().substring(0, 8));
    jdbc.update(
        "INSERT INTO public.cafeterias(id,site_id,name,is_active,lunch_order_start,lunch_order_end) VALUES (?,?,'Cafetería de prueba',false,'06:00','18:00')",
        cafeteria,
        site);
    UUID admin = UUID.randomUUID();
    jdbc.execute(
        (Connection connection) -> {
          connection.setAutoCommit(false);
          var one = new JdbcTemplate(new SingleConnectionDataSource(connection, true));
          one.update(
              "INSERT INTO auth.users(id,email) VALUES (?, ?)", admin, admin + "@example.invalid");
          one.update(
              "INSERT INTO public.user_roles(user_id,role_id) SELECT ?,id FROM public.roles WHERE name::text='ADMIN'",
              admin);
          one.update(
              "INSERT INTO public.cafeteria_users(user_id,cafeteria_id) VALUES (?,?)",
              admin,
              cafeteria);
          one.update("UPDATE public.users SET is_active=true WHERE id=?", admin);
          one.update("UPDATE public.cafeterias SET is_active=true WHERE id=?", cafeteria);
          connection.commit();
          connection.setAutoCommit(true);
          return null;
        });
    return cafeteria;
  }

  static UUID client() {
    UUID id = UUID.randomUUID();
    jdbc.update("INSERT INTO auth.users(id,email) VALUES (?, ?)", id, id + "@ustavillavo.edu.co");
    jdbc.update(
        "INSERT INTO public.clients(user_id,full_name,institution_id,client_type,institutional_code) "
            + "SELECT ?,'Cliente de prueba',id,'STUDENT',? FROM public.institutions WHERE email_domain='ustavillavo.edu.co'",
        id,
        String.valueOf(CODES.incrementAndGet()));
    jdbc.update(
        "INSERT INTO public.user_roles(user_id,role_id) SELECT ?,id FROM public.roles WHERE name::text='CLIENT'",
        id);
    jdbc.update("UPDATE public.users SET is_active=true WHERE id=?", id);
    return id;
  }

  /**
   * An order of a fresh client, created at {@code created} and moved to {@code state} at {@code
   * at}.
   */
  UUID order(Instant created, String state, Instant at, int total, int fee) {
    UUID user = client();
    UUID id = UUID.randomUUID();
    jdbc.update(
        "INSERT INTO public.orders(id,cafeteria_id,client_id,client_name,status,total,service_fee_cop,created_at,client_code,client_type) "
            + "SELECT ?,?,c.id,c.full_name,'PENDING',?,?,?,c.institutional_code,c.client_type FROM public.clients c WHERE c.user_id=?",
        id,
        cafe,
        total,
        fee,
        created.atOffset(ZoneOffset.UTC),
        user);
    if (at == null) return id;
    var when = at.atOffset(ZoneOffset.UTC);
    switch (state) {
      case "DELIVERED" ->
          jdbc.update(
              "UPDATE public.orders SET status='DELIVERED', called_at=?, delivered_at=? WHERE id=?",
              when,
              when,
              id);
      case "NOT_COLLECTED" ->
          jdbc.update(
              "UPDATE public.orders SET status='NOT_COLLECTED', called_at=?, not_collected_at=? WHERE id=?",
              when,
              when,
              id);
      case "CANCELLED" ->
          jdbc.update(
              "UPDATE public.orders SET status='CANCELLED', cancelled_at=?, cancellation_source='CLIENT' WHERE id=?",
              when,
              id);
      default -> throw new IllegalArgumentException(state);
    }
    return id;
  }
}

package com.santotofood.config;

import static org.junit.jupiter.api.Assertions.*;

import com.santotofood.adapter.out.persistence.ClientOrderPersistenceAdapter;
import com.santotofood.adapter.out.persistence.StaleOrderClosePersistenceAdapter;
import com.santotofood.application.exception.ClientOrderException;
import com.santotofood.application.port.in.CloseStaleOrdersUseCase.ClosedOrders;
import com.santotofood.application.port.in.CreateOwnOrderUseCase.Line;
import com.santotofood.application.port.in.CreateOwnOrderUseCase.OrderRequest;
import com.santotofood.application.service.ClientOrderCreationService;
import com.santotofood.application.service.DailyCloseService;
import com.santotofood.domain.model.BusinessDate;
import com.santotofood.domain.port.out.TimeProvider;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import javax.sql.DataSource;
import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;

/**
 * B19 daily close on the real 001-021 schema: same rule as scripts/supabase/close-stale-orders.sql,
 * stamped by the TimeProvider, skipping locked rows, idempotent, and leaving every finished order,
 * worker rejections included, as it was.
 */
@Timeout(120)
@TestMethodOrder(MethodOrderer.MethodName.class)
class DailyClosePostgresTest {
  // Noon in America/Bogota; the business day started at 05:00Z.
  static final Instant NOW = Instant.parse("2026-11-20T17:00:00Z");
  static final Instant DAY_START = Instant.parse("2026-11-20T05:00:00Z");
  static final Instant YESTERDAY = Instant.parse("2026-11-19T15:00:00Z");
  static final Instant TODAY = Instant.parse("2026-11-20T14:00:00Z");
  static final UUID CAFE = UUID.randomUUID();
  static final UUID LUNCH = UUID.randomUUID();
  static final UUID WORKER = UUID.randomUUID();
  static final AtomicInteger CODES = new AtomicInteger(5000000);
  static Process database;
  static DataSource dataSource;
  static JdbcTemplate jdbc;
  static DailyCloseService close;
  static ClientOrderCreationService create;

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
    dataSource = new DriverManagerDataSource(url, "postgres", "");
    jdbc = new JdbcTemplate(dataSource);
    seed();
    var manager = new DataSourceTransactionManager(dataSource);
    TimeProvider clock = () -> NOW;
    close = new DailyCloseService(new StaleOrderClosePersistenceAdapter(jdbc), clock, manager);
    create =
        new ClientOrderCreationService(new ClientOrderPersistenceAdapter(jdbc), clock, manager);
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

  /** Each test starts with no order: the close is global, so tests must not see each other's. */
  @BeforeEach
  void clean() {
    jdbc.update("DELETE FROM public.order_items");
    jdbc.update("DELETE FROM public.orders");
  }

  // ---------------------------------------------------------------- fixture

  static void seed() {
    UUID site = UUID.randomUUID();
    jdbc.update(
        "INSERT INTO public.sites(id,name,city,institution_id) SELECT ?,'Sede Principal','Villavicencio',id FROM public.institutions WHERE email_domain='ustavillavo.edu.co'",
        site);
    jdbc.update(
        "INSERT INTO public.cafeterias(id,site_id,name,is_active,lunch_order_start,lunch_order_end) VALUES (?,?,'Cafetería Central',false,'06:00','18:00')",
        CAFE,
        site);
    jdbc.update(
        "INSERT INTO public.lunches(id,cafeteria_id,name,price,category) VALUES (?,?,'Corriente',13000,'CORRIENTE')",
        LUNCH,
        CAFE);
    staff(UUID.randomUUID(), "ADMIN", true);
    staff(WORKER, "WORKER", false);
    var today = BusinessDate.from(NOW).value();
    jdbc.update(
        "INSERT INTO public.cafeteria_daily_states(cafeteria_id,business_date,is_open) VALUES (?,?,true)",
        CAFE,
        today);
    jdbc.update(
        "INSERT INTO public.daily_item_availability(cafeteria_id,item_id,business_date,is_available) VALUES (?,?,?,true)",
        CAFE,
        LUNCH,
        today);
  }

  /** 009: activating the cafeteria needs its ADMIN active and assigned in the same transaction. */
  static void staff(UUID id, String role, boolean activateCafeteria) {
    jdbc.execute(
        (Connection connection) -> {
          connection.setAutoCommit(false);
          var tx = new JdbcTemplate(new SingleConnectionDataSource(connection, true));
          tx.update("INSERT INTO auth.users(id,email) VALUES (?, ?)", id, id + "@example.invalid");
          tx.update(
              "INSERT INTO public.user_roles(user_id,role_id) SELECT ?,id FROM public.roles WHERE name::text=?",
              id,
              role);
          tx.update(
              "INSERT INTO public.cafeteria_users(user_id,cafeteria_id) VALUES (?,?)", id, CAFE);
          tx.update("UPDATE public.users SET is_active=true WHERE id=?", id);
          if (activateCafeteria)
            tx.update("UPDATE public.cafeterias SET is_active=true WHERE id=?", CAFE);
          connection.commit();
          connection.setAutoCommit(true);
          return null;
        });
  }

  static UUID client() {
    UUID id = UUID.randomUUID();
    jdbc.update("INSERT INTO auth.users(id,email) VALUES (?, ?)", id, id + "@ustavillavo.edu.co");
    jdbc.update(
        "INSERT INTO public.clients(user_id,full_name,institution_id,client_type,institutional_code) "
            + "SELECT ?,'Ana Torres',id,'STUDENT',? FROM public.institutions WHERE email_domain='ustavillavo.edu.co'",
        id,
        String.valueOf(CODES.incrementAndGet()));
    jdbc.update(
        "INSERT INTO public.user_roles(user_id,role_id) SELECT ?,id FROM public.roles WHERE name::text='CLIENT'",
        id);
    jdbc.update("UPDATE public.users SET is_active=true WHERE id=?", id);
    return id;
  }

  /** An order of a fresh client created at {@code created}, then moved to {@code state}. */
  static UUID order(Instant created, String state) {
    return order(client(), created, state);
  }

  static UUID order(UUID user, Instant created, String state) {
    UUID id = UUID.randomUUID();
    jdbc.update(
        "INSERT INTO public.orders(id,cafeteria_id,client_id,client_name,status,total,created_at,client_code,client_type) "
            + "SELECT ?,?,c.id,c.full_name,'PENDING',13000,?,c.institutional_code,c.client_type FROM public.clients c WHERE c.user_id=?",
        id,
        CAFE,
        created.atOffset(ZoneOffset.UTC),
        user);
    String sql =
        switch (state) {
          case "PENDING" -> null;
          case "PREPARING", "READY" -> "UPDATE public.orders SET status='" + state + "' WHERE id=?";
          // reminder_count stays 0: the close does not need the worker's three reminders.
          case "CALLED" -> "UPDATE public.orders SET status='CALLED', called_at=now() WHERE id=?";
          case "DELIVERED" ->
              "UPDATE public.orders SET status='DELIVERED', called_at=now(), delivered_at=now() WHERE id=?";
          case "NOT_COLLECTED" ->
              "UPDATE public.orders SET status='NOT_COLLECTED', called_at=now(), not_collected_at=now() WHERE id=?";
          case "CANCELLED_CLIENT" ->
              "UPDATE public.orders SET status='CANCELLED', cancelled_at=now(), cancellation_source='CLIENT' WHERE id=?";
          case "CANCELLED_SYSTEM" ->
              "UPDATE public.orders SET status='CANCELLED', cancelled_at=now(), cancellation_source='SYSTEM' WHERE id=?";
          case "REJECTED" ->
              "UPDATE public.orders SET status='CANCELLED', cancelled_at=now(), cancellation_source='WORKER', "
                  + "rejection_reason='Se acabó el pollo', rejected_by='"
                  + WORKER
                  + "' WHERE id=?";
          default -> throw new IllegalArgumentException(state);
        };
    if (sql != null) jdbc.update(sql, id);
    return id;
  }

  static Map<String, Object> row(UUID order) {
    return jdbc.queryForMap(
        "SELECT status::text AS status, cancellation_source, cancelled_by_client, rejection_reason, "
            + "rejected_by, cancelled_at, not_collected_at, version FROM public.orders WHERE id=?",
        order);
  }

  static String snapshot(UUID order) {
    return jdbc.queryForObject(
        "SELECT to_jsonb(o)::text FROM public.orders o WHERE id=?", String.class, order);
  }

  static long version(UUID order) {
    return ((Number) row(order).get("version")).longValue();
  }

  static Instant instant(Object timestamp) {
    return ((java.sql.Timestamp) timestamp).toInstant();
  }

  // ---------------------------------------------------------------- the rule

  @Test
  void anOldPendingOrderIsCancelledBySystemAtTheClocksTime() {
    UUID stale = order(YESTERDAY, "PENDING");
    long before = version(stale);
    assertEquals(new ClosedOrders(1, 0), close.closeStaleOrders());
    var row = row(stale);
    assertEquals("CANCELLED", row.get("status"));
    assertEquals("SYSTEM", row.get("cancellation_source"));
    assertEquals(false, row.get("cancelled_by_client"));
    assertNull(row.get("rejection_reason"));
    assertNull(row.get("rejected_by"));
    assertEquals(NOW, instant(row.get("cancelled_at")));
    assertEquals(before + 1, version(stale));
  }

  @ParameterizedTest
  @ValueSource(strings = {"PREPARING", "READY", "CALLED"})
  void oldPreparingReadyAndCalledOrdersBecomeNotCollectedWithoutTheReminderRule(String state) {
    UUID stale = order(YESTERDAY, state);
    long before = version(stale);
    assertEquals(new ClosedOrders(0, 1), close.closeStaleOrders());
    var row = row(stale);
    assertEquals("NOT_COLLECTED", row.get("status"));
    assertEquals(NOW, instant(row.get("not_collected_at")));
    assertNull(row.get("cancellation_source"));
    assertEquals(before + 1, version(stale));
  }

  @Test
  void todaysOrdersAndFinishedOnesIncludingWorkerRejectionsAreNotTouched() {
    var untouched =
        List.of(
            order(TODAY, "PENDING"),
            order(TODAY, "PREPARING"),
            order(TODAY, "CALLED"),
            // Exactly at midnight in Bogota already belongs to today.
            order(DAY_START, "PENDING"),
            order(YESTERDAY, "DELIVERED"),
            order(YESTERDAY, "NOT_COLLECTED"),
            order(YESTERDAY, "CANCELLED_CLIENT"),
            order(YESTERDAY, "CANCELLED_SYSTEM"),
            order(YESTERDAY, "REJECTED"));
    var before = untouched.stream().map(DailyClosePostgresTest::snapshot).toList();
    UUID justBefore = order(DAY_START.minus(1, ChronoUnit.MICROS), "PENDING");

    assertEquals(new ClosedOrders(1, 0), close.closeStaleOrders());

    assertEquals(before, untouched.stream().map(DailyClosePostgresTest::snapshot).toList());
    assertEquals("CANCELLED", row(justBefore).get("status"));
  }

  @Test
  void aWorkerRejectionKeepsItsSourceReasonAndWorker() {
    UUID rejected = order(YESTERDAY, "REJECTED");
    var before = row(rejected);
    close.closeStaleOrders();
    var after = row(rejected);
    assertEquals(before, after);
    assertEquals("WORKER", after.get("cancellation_source"));
    assertEquals("Se acabó el pollo", after.get("rejection_reason"));
    assertEquals(WORKER, after.get("rejected_by"));
  }

  @Test
  void runningItAgainChangesNothing() {
    UUID pending = order(YESTERDAY, "PENDING");
    UUID called = order(YESTERDAY, "CALLED");
    assertEquals(new ClosedOrders(1, 1), close.closeStaleOrders());
    var after = List.of(snapshot(pending), snapshot(called));
    assertEquals(new ClosedOrders(0, 0), close.closeStaleOrders());
    assertEquals(after, List.of(snapshot(pending), snapshot(called)));
  }

  // ---------------------------------------------------------------- locks and races

  @Test
  void aRowLockedByAnotherTransactionIsSkippedAndClosedOnTheNextRun() throws Exception {
    UUID locked = order(YESTERDAY, "PENDING");
    UUID free = order(YESTERDAY, "PREPARING");
    try (Connection holder = dataSource.getConnection()) {
      holder.setAutoCommit(false);
      try (var lock =
          holder.prepareStatement("SELECT 1 FROM public.orders WHERE id=? FOR UPDATE")) {
        lock.setObject(1, locked);
        lock.executeQuery();
      }
      // SKIP LOCKED does not wait: the run returns while the row is still held.
      assertEquals(new ClosedOrders(0, 1), close.closeStaleOrders());
      assertEquals("PENDING", row(locked).get("status"));
      assertEquals("NOT_COLLECTED", row(free).get("status"));
      holder.rollback();
    }
    assertEquals(new ClosedOrders(1, 0), close.closeStaleOrders());
    assertEquals("CANCELLED", row(locked).get("status"));
  }

  @Test
  void twoInstancesRunningAtOnceCloseEachOrderExactlyOnce() throws Exception {
    var stale = new java.util.ArrayList<UUID>();
    for (int i = 0; i < 20; i++) stale.add(order(YESTERDAY, i % 2 == 0 ? "PENDING" : "READY"));
    var versions = stale.stream().map(DailyClosePostgresTest::version).toList();
    try (var pool = Executors.newFixedThreadPool(2)) {
      var a = pool.submit(close::closeStaleOrders);
      var b = pool.submit(close::closeStaleOrders);
      var first = a.get(30, TimeUnit.SECONDS);
      var second = b.get(30, TimeUnit.SECONDS);
      assertEquals(10, first.cancelled() + second.cancelled());
      assertEquals(10, first.notCollected() + second.notCollected());
    }
    for (int i = 0; i < stale.size(); i++)
      assertEquals(versions.get(i) + 1, version(stale.get(i)), "closed once: " + i);
  }

  // ---------------------------------------------------------------- the client afterwards

  @Test
  void aClientWithAnOldPendingOrderCanOrderAgainAfterTheClose() {
    UUID user = client();
    UUID stale = order(user, YESTERDAY, "PENDING");
    var request = new OrderRequest(CAFE, List.of(new Line(LUNCH, 1)), null);

    var blocked =
        assertThrows(
            ClientOrderException.class,
            () -> create.createOwnOrder(user, "key-before-the-close-0001", request));
    assertEquals("ACTIVE_ORDER_EXISTS", blocked.getCode());
    assertEquals(stale, blocked.getActiveOrderId());

    close.closeStaleOrders();

    var created = create.createOwnOrder(user, "key-after-the-close-00001", request);
    assertTrue(created.created());
    assertEquals("PENDING", created.order().status());
    assertEquals("CANCELLED", row(stale).get("status"));
  }
}

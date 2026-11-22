package com.santotofood.config;

import static org.junit.jupiter.api.Assertions.*;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;

/**
 * Migration 032: public.close_stale_orders() closes exactly what the backend's daily close does
 * (resources/sql/daily-close/*.sql), with the cut at the start of today in America/Bogota, leaves
 * today's orders alone, lets the triggers stamp updated_at, is idempotent and only its owner may
 * call it. pg_cron does not exist here: the schedule is not covered.
 */
@Timeout(120)
class CloseStaleOrdersFunctionPostgresTest {
  static final UUID CAFE = UUID.randomUUID();
  static final AtomicInteger CODES = new AtomicInteger(6000000);
  static Process database;
  static JdbcTemplate jdbc;

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
    jdbc = new JdbcTemplate(new DriverManagerDataSource(url, "postgres", ""));
    seed();
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
  void clean() {
    jdbc.update("DELETE FROM public.order_items");
    jdbc.update("DELETE FROM public.orders");
  }

  @Test
  void itClosesYesterdaysActiveOrdersLikeTheBackendAndLeavesTodayAlone() {
    Instant dayStart = bogotaDayStart();
    Instant yesterday = dayStart.minusSeconds(6 * 3600);
    UUID pending = order(yesterday, "PENDING");
    UUID preparing = order(yesterday, "PREPARING");
    UUID ready = order(yesterday, "READY");
    UUID called = order(yesterday, "CALLED");
    UUID delivered = order(yesterday, "DELIVERED");
    UUID today = order(Instant.now(), "PENDING");
    Map<String, Object> calledBefore = row(called);
    Map<String, Object> todayBefore = row(today);
    Map<UUID, Object> updatedBefore = new java.util.HashMap<>();
    for (UUID id : new UUID[] {pending, preparing, ready, called})
      updatedBefore.put(id, row(id).get("updated_at"));

    assertEquals(4, close());

    var cancelled = row(pending);
    assertEquals("CANCELLED", cancelled.get("status"));
    assertEquals("SYSTEM", cancelled.get("cancellation_source"));
    assertNotNull(cancelled.get("cancelled_at"));
    assertNull(cancelled.get("not_collected_at"));
    for (UUID id : new UUID[] {preparing, ready, called}) {
      var closed = row(id);
      assertEquals("NOT_COLLECTED", closed.get("status"), id.toString());
      assertNotNull(closed.get("not_collected_at"));
      assertNull(closed.get("cancellation_source"));
      assertNull(closed.get("cancelled_at"));
    }
    // CALLED keeps its call and its reminders, as in the backend.
    var calledAfter = row(called);
    assertEquals(calledBefore.get("called_at"), calledAfter.get("called_at"));
    assertEquals(2, ((Number) calledAfter.get("reminder_count")).intValue());
    // The triggers run for the function too: updated_at moves and so does the version.
    for (UUID id : updatedBefore.keySet()) {
      var after = row(id);
      assertTrue(
          ((Timestamp) after.get("updated_at")).after((Timestamp) updatedBefore.get(id)),
          "updated_at of " + id);
    }
    assertTrue(
        ((Number) calledAfter.get("version")).longValue()
            > ((Number) calledBefore.get("version")).longValue());
    // Finished orders and today's are untouched.
    assertEquals("DELIVERED", row(delivered).get("status"));
    assertEquals(todayBefore, row(today));

    assertEquals(0, close(), "a second run closes nothing");
    assertEquals("PENDING", row(today).get("status"));
  }

  @Test
  void theCutIsTheStartOfTodayInBogotaNotTheServersDate() {
    Instant dayStart = bogotaDayStart();
    UUID justBefore = order(dayStart.minusSeconds(1), "PENDING");
    UUID atStart = order(dayStart, "PENDING");
    assertEquals(1, close());
    assertEquals("CANCELLED", row(justBefore).get("status"));
    assertEquals("PENDING", row(atStart).get("status"));
    // The cut is 05:00 UTC whatever the session's time zone.
    assertEquals(5, dayStart.atOffset(ZoneOffset.UTC).getHour());
  }

  @Test
  void itIsSecurityDefinerWithAnEmptySearchPathAndClosedToTheBrowser() {
    var function =
        jdbc.queryForMap(
            "SELECT p.prosecdef, array_to_string(p.proconfig, ',') AS config FROM pg_proc p "
                + "WHERE p.oid = 'public.close_stale_orders()'::regprocedure");
    assertEquals(true, function.get("prosecdef"));
    assertEquals("search_path=\"\"", function.get("config"));
    for (String role : new String[] {"anon", "authenticated", "public"})
      assertFalse(
          jdbc.queryForObject(
              "SELECT has_function_privilege(?, 'public.close_stale_orders()', 'EXECUTE')",
              Boolean.class,
              role),
          role);
  }

  // ---------------------------------------------------------------- fixture

  static int close() {
    return jdbc.queryForObject("SELECT public.close_stale_orders()", Integer.class);
  }

  static Instant bogotaDayStart() {
    return jdbc.queryForObject(
            "SELECT (date_trunc('day', now() AT TIME ZONE 'America/Bogota')) AT TIME ZONE 'America/Bogota'",
            Timestamp.class)
        .toInstant();
  }

  static Map<String, Object> row(UUID id) {
    return jdbc.queryForMap(
        "SELECT status::text AS status, cancellation_source, cancelled_at, not_collected_at, "
            + "called_at, reminder_count, updated_at, version FROM public.orders WHERE id=?",
        id);
  }

  static void seed() {
    UUID site = UUID.randomUUID();
    jdbc.update(
        "INSERT INTO public.sites(id,name,city,institution_id) SELECT ?,'Sede Principal','Villavicencio',id FROM public.institutions WHERE email_domain='ustavillavo.edu.co'",
        site);
    jdbc.update(
        "INSERT INTO public.cafeterias(id,site_id,name,is_active,lunch_order_start,lunch_order_end) VALUES (?,?,'Cafetería Central',false,'06:00','18:00')",
        CAFE,
        site);
    UUID admin = UUID.randomUUID();
    jdbc.execute(
        (Connection connection) -> {
          connection.setAutoCommit(false);
          var tx = new JdbcTemplate(new SingleConnectionDataSource(connection, true));
          tx.update(
              "INSERT INTO auth.users(id,email) VALUES (?, ?)", admin, admin + "@example.invalid");
          tx.update(
              "INSERT INTO public.user_roles(user_id,role_id) SELECT ?,id FROM public.roles WHERE name::text='ADMIN'",
              admin);
          tx.update(
              "INSERT INTO public.cafeteria_users(user_id,cafeteria_id) VALUES (?,?)", admin, CAFE);
          tx.update("UPDATE public.users SET is_active=true WHERE id=?", admin);
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
            + "SELECT ?,'Cliente de prueba',id,'STUDENT',? FROM public.institutions WHERE email_domain='ustavillavo.edu.co'",
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
    UUID user = client();
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
          case "CALLED" ->
              "UPDATE public.orders SET status='CALLED', called_at=now(), reminder_count=2 WHERE id=?";
          case "DELIVERED" ->
              "UPDATE public.orders SET status='DELIVERED', called_at=now(), delivered_at=now() WHERE id=?";
          default -> throw new IllegalArgumentException(state);
        };
    if (sql != null) jdbc.update(sql, id);
    return id;
  }
}

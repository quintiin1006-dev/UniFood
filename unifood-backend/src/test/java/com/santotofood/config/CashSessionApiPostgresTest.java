package com.santotofood.config;

import static org.hamcrest.Matchers.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.jayway.jsonpath.JsonPath;
import com.santotofood.adapter.in.web.CashController;
import com.santotofood.adapter.in.web.SuperAdminCashController;
import com.santotofood.adapter.in.web.error.CashExceptionHandler;
import com.santotofood.adapter.out.persistence.AuthorizationPersistenceAdapter;
import com.santotofood.adapter.out.persistence.CashSessionPersistenceAdapter;
import com.santotofood.application.service.CashSessionService;
import com.santotofood.domain.port.out.TimeProvider;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import javax.sql.DataSource;
import org.junit.jupiter.api.*;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;
import org.springframework.mock.web.MockServletContext;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.jwt.BadJwtException;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.transaction.annotation.EnableTransactionManagement;
import org.springframework.web.context.support.AnnotationConfigWebApplicationContext;
import org.springframework.web.servlet.config.annotation.EnableWebMvc;

/**
 * Cash register on the real schema (028): sales come from delivered orders in the session window,
 * roles and cafeteria from PostgreSQL, a closed session is immutable, and a delivery that races a
 * close is either counted or refused with the new figures, never lost.
 */
@Timeout(240)
class CashSessionApiPostgresTest {
  // 11:00 in America/Bogota on 2026-11-20.
  static final Instant OPEN_AT = Instant.parse("2026-11-20T16:00:00Z");
  static final AtomicReference<Instant> CLOCK = new AtomicReference<>(OPEN_AT);
  static final UUID SITE = UUID.randomUUID();
  static final UUID SUPER = UUID.randomUUID();
  static String url;
  static Process database;
  static JdbcTemplate jdbc;
  static DataSource dataSource;
  static AnnotationConfigWebApplicationContext context;
  static MockMvc mvc;

  @Configuration
  @EnableWebMvc
  @EnableTransactionManagement
  static class TestConfig {
    @Bean
    DataSource dataSource() {
      return dataSource;
    }

    @Bean
    JdbcTemplate jdbc(DataSource ds) {
      return new JdbcTemplate(ds);
    }

    @Bean
    DataSourceTransactionManager transactionManager(DataSource ds) {
      return new DataSourceTransactionManager(ds);
    }

    @Bean
    TimeProvider clock() {
      return CLOCK::get;
    }

    @Bean
    JwtDecoder jwtDecoder() {
      JwtDecoder decoder = mock(JwtDecoder.class);
      when(decoder.decode(anyString())).thenThrow(new BadJwtException("Rejected test token"));
      return decoder;
    }
  }

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
    url = metadata.substring(metadata.indexOf("jdbc:"), metadata.lastIndexOf('"'));
    assertTrue(url.startsWith("jdbc:postgresql://127.0.0.1:"));
    dataSource = new DriverManagerDataSource(url, "postgres", "");
    jdbc = new JdbcTemplate(dataSource);
    jdbc.update(
        "INSERT INTO public.sites(id,name,city,institution_id) SELECT ?,'Sede Principal','Villavicencio',id FROM public.institutions WHERE email_domain='ustavillavo.edu.co'",
        SITE);
    inTransaction(tx -> user(tx, SUPER, "SUPER_ADMIN", null, "Dueño"));
    context = new AnnotationConfigWebApplicationContext();
    context.setServletContext(new MockServletContext());
    context.register(
        TestConfig.class,
        SecurityConfig.class,
        OrderAuthorization.class,
        AuthorizationPersistenceAdapter.class,
        CashSessionPersistenceAdapter.class,
        CashSessionService.class,
        CashController.class,
        SuperAdminCashController.class,
        CashExceptionHandler.class);
    context.refresh();
    mvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
  }

  @AfterAll
  static void stop() throws Exception {
    if (context != null) context.close();
    if (database != null && database.isAlive()) {
      database.getOutputStream().write("stop\n".getBytes(StandardCharsets.UTF_8));
      database.getOutputStream().flush();
      assertTrue(database.waitFor(30, TimeUnit.SECONDS));
      assertEquals(0, database.exitValue());
    }
  }

  @BeforeEach
  void resetClock() {
    CLOCK.set(OPEN_AT);
  }

  // ---------------------------------------------------------------- fixture

  interface Work {
    void run(JdbcTemplate tx);
  }

  static void inTransaction(Work work) {
    jdbc.execute(
        (Connection connection) -> {
          connection.setAutoCommit(false);
          work.run(new JdbcTemplate(new SingleConnectionDataSource(connection, true)));
          connection.commit();
          connection.setAutoCommit(true);
          return null;
        });
  }

  static void user(JdbcTemplate tx, UUID id, String role, UUID cafeteria, String fullName) {
    tx.update(
        "INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES (?, ?, ?::jsonb)",
        id,
        id + "@example.invalid",
        fullName == null ? "{}" : "{\"full_name\":\"" + fullName + "\"}");
    tx.update(
        "INSERT INTO public.user_roles(user_id,role_id) SELECT ?,id FROM public.roles WHERE name::text=?",
        id,
        role);
    if (cafeteria != null)
      tx.update(
          "INSERT INTO public.cafeteria_users(user_id,cafeteria_id) VALUES (?,?)", id, cafeteria);
    tx.update("UPDATE public.users SET is_active=true WHERE id=?", id);
  }

  /** A cafeteria of its own per test, with its WORKER and ADMIN. */
  record World(UUID cafeteria, UUID worker, UUID admin) {}

  static World world() {
    var w = new World(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID());
    jdbc.update(
        "INSERT INTO public.cafeterias(id,site_id,name,is_active,lunch_order_start,lunch_order_end) VALUES (?,?,?,false,'06:00','18:00')",
        w.cafeteria(),
        SITE,
        "Cafetería " + w.cafeteria().toString().substring(0, 8));
    inTransaction(
        tx -> {
          user(tx, w.admin(), "ADMIN", w.cafeteria(), "Admin Central");
          tx.update("UPDATE public.cafeterias SET is_active=true WHERE id=?", w.cafeteria());
        });
    inTransaction(tx -> user(tx, w.worker(), "WORKER", w.cafeteria(), "Wilson Cajero"));
    return w;
  }

  static UUID order(UUID cafeteria, String status, String total, Instant deliveredAt) {
    UUID id = UUID.randomUUID();
    jdbc.update(
        "INSERT INTO public.orders(id,cafeteria_id,client_name,status,total,created_at,delivered_at,not_collected_at,cancelled_at) "
            + "VALUES (?,?,'Ana Torres',CAST(? AS public.order_status),CAST(? AS numeric),?,?,?,?)",
        id,
        cafeteria,
        status,
        total,
        Timestamp.from(OPEN_AT.minusSeconds(3600)),
        deliveredAt == null ? null : Timestamp.from(deliveredAt),
        status.equals("NOT_COLLECTED") ? Timestamp.from(OPEN_AT.plusSeconds(60)) : null,
        status.equals("CANCELLED") ? Timestamp.from(OPEN_AT.plusSeconds(60)) : null);
    return id;
  }

  static RequestPostProcessor as(UUID user) {
    // Every token claims ADMIN: only PostgreSQL may decide.
    return jwt()
        .jwt(token -> token.subject(user.toString()).claim("role", "ADMIN"))
        .authorities(new SimpleGrantedAuthority("ROLE_ADMIN"));
  }

  static ResultActions call(
      org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder request,
      UUID user,
      String body)
      throws Exception {
    request.with(as(user));
    if (body != null) request.contentType(MediaType.APPLICATION_JSON).content(body);
    return mvc.perform(request);
  }

  static String json(MvcResult result) throws Exception {
    return result.getResponse().getContentAsString(StandardCharsets.UTF_8);
  }

  static <T> T read(MvcResult result, String path) throws Exception {
    return JsonPath.read(json(result), path);
  }

  static String openSession(UUID user, String shift, long openingFloat) throws Exception {
    var result =
        call(
                post("/api/cash/sessions"),
                user,
                "{\"shift\":\"" + shift + "\",\"openingFloat\":" + openingFloat + "}")
            .andExpect(status().isOk())
            .andReturn();
    return read(result, "$.session.id");
  }

  static ResultActions movement(UUID user, String session, String kind, long amount, String reason)
      throws Exception {
    return movement(user, session, UUID.randomUUID(), kind, amount, reason);
  }

  static ResultActions movement(
      UUID user, String session, UUID requestId, String kind, long amount, String reason)
      throws Exception {
    return call(
        post("/api/cash/sessions/" + session + "/movements"),
        user,
        "{\"requestId\":\""
            + requestId
            + "\",\"kind\":\""
            + kind
            + "\",\"amount\":"
            + amount
            + ",\"reason\":\""
            + reason
            + "\"}");
  }

  /** Count as 50.000 bills plus 50 coins for the remainder (amounts are multiples of 50). */
  static String lines(long total) {
    long bills = total / 50000, rest = (total % 50000) / 50;
    return "[{\"denomination\":50000,\"quantity\":"
        + bills
        + "},{\"denomination\":50,\"quantity\":"
        + rest
        + "}]";
  }

  static ResultActions preview(UUID user, String session, long counted) throws Exception {
    return call(
        post("/api/cash/sessions/" + session + "/close-preview"),
        user,
        "{\"lines\":" + lines(counted) + "}");
  }

  static int version(String session) {
    return jdbc.queryForObject(
        "SELECT version FROM public.cash_sessions WHERE id=?::uuid", Integer.class, session);
  }

  static ResultActions close(
      UUID user, String session, long counted, long expected, String note, Boolean force)
      throws Exception {
    return call(
        post("/api/cash/sessions/" + session + "/close"),
        user,
        "{\"lines\":"
            + lines(counted)
            + ",\"note\":"
            + (note == null ? "null" : "\"" + note + "\"")
            + ",\"expectedCash\":"
            + expected
            + ",\"expectedVersion\":"
            + version(session)
            + (force == null ? "" : ",\"force\":" + force)
            + "}");
  }

  static ResultActions reopen(UUID user, String session, String reason) throws Exception {
    return call(
        post("/api/cash/sessions/" + session + "/reopen"),
        user,
        "{\"reason\":\"" + reason + "\",\"expectedVersion\":" + version(session) + "}");
  }

  static void at(Instant instant) {
    CLOCK.set(instant);
  }

  // ---------------------------------------------------------------- calculation

  @Test
  void expectedCountsOnlyDeliveredOrdersInTheWindowPlusMovements() throws Exception {
    var w = world();
    var other = world();
    // Before opening: outside the window, it shows as a sale without a drawer.
    order(w.cafeteria(), "DELIVERED", "11000", OPEN_AT.minusSeconds(600));
    String session = openSession(w.worker(), "LUNCH", 50000);
    order(w.cafeteria(), "DELIVERED", "13000", OPEN_AT.plusSeconds(300));
    order(w.cafeteria(), "DELIVERED", "9500.00", OPEN_AT.plusSeconds(400));
    order(w.cafeteria(), "CANCELLED", "9000", null);
    order(w.cafeteria(), "NOT_COLLECTED", "7000", null);
    order(other.cafeteria(), "DELIVERED", "15000", OPEN_AT.plusSeconds(300));
    at(OPEN_AT.plusSeconds(900));
    movement(w.worker(), session, "INCOME", 5000, "Ajuste de vuelto").andExpect(status().isOk());
    movement(w.worker(), session, "EXPENSE", 20000, "Compra de hielo")
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.live.sales").value(22500))
        .andExpect(jsonPath("$.live.deliveredOrders").value(2))
        .andExpect(jsonPath("$.live.expected").value(57500))
        .andExpect(jsonPath("$.unsessionedToday.orders").value(1))
        .andExpect(jsonPath("$.unsessionedToday.amount").value(11000));
    at(OPEN_AT.plusSeconds(3600));
    preview(w.worker(), session, 57500)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.expected").value(57500))
        .andExpect(jsonPath("$.difference").value(0))
        .andExpect(jsonPath("$.outcome").value("BALANCED"))
        .andExpect(jsonPath("$.noteRequired").value(false));
    var closed =
        close(w.worker(), session, 57500, 57500, null, null)
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.session.status").value("CLOSED"))
            .andExpect(jsonPath("$.session.sequenceNumber").value(1))
            .andExpect(jsonPath("$.session.businessDate").value("2026-11-20"))
            .andExpect(jsonPath("$.session.sales").value(22500))
            .andExpect(jsonPath("$.session.income").value(5000))
            .andExpect(jsonPath("$.session.expense").value(20000))
            .andExpect(jsonPath("$.session.counted").value(57500))
            .andExpect(jsonPath("$.session.outsideTolerance").value(false))
            .andExpect(jsonPath("$.session.closedByName").value("Wilson Cajero"))
            .andExpect(jsonPath("$.movements.length()").value(2))
            .andExpect(jsonPath("$.countLines[0].denomination").value(50000))
            .andReturn();
    assertFalse(json(closed).contains("@example.invalid"), "never the email");
    // The order totals are untouched (option b).
    assertEquals(
        0,
        new BigDecimal("13000")
            .compareTo(
                jdbc.queryForObject(
                    "SELECT total FROM public.orders WHERE cafeteria_id=? AND total=13000",
                    BigDecimal.class,
                    w.cafeteria())));
    var audit =
        jdbc.queryForList(
            "SELECT action, source FROM public.cash_sessions_audit WHERE session_id=?::uuid ORDER BY id",
            session);
    assertEquals(
        List.of("OPENED/API", "MOVEMENT/API", "MOVEMENT/API", "CLOSED/API"),
        audit.stream().map(r -> r.get("action") + "/" + r.get("source")).toList());
  }

  @Test
  void withoutSalesItBalancesAgainstTheFloat() throws Exception {
    var w = world();
    String session = openSession(w.worker(), "BREAKFAST", 30000);
    at(OPEN_AT.plusSeconds(60));
    close(w.worker(), session, 30000, 30000, null, null)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.session.sales").value(0))
        .andExpect(jsonPath("$.session.difference").value(0))
        .andExpect(jsonPath("$.session.outcome").value("BALANCED"));
  }

  @Test
  void aDifferenceNeedsANoteAndIsFlaggedOutsideTolerance() throws Exception {
    var w = world();
    String surplus = openSession(w.worker(), "BREAKFAST", 20000);
    at(OPEN_AT.plusSeconds(60));
    close(w.worker(), surplus, 20500, 20000, null, null)
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("CASH_NOTE_REQUIRED"));
    close(w.worker(), surplus, 20500, 20000, "corta", null)
        .andExpect(jsonPath("$.code").value("CASH_NOTE_REQUIRED"));
    close(w.worker(), surplus, 20500, 20000, "Sobran 500 de un vuelto", null)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.session.difference").value(500))
        .andExpect(jsonPath("$.session.outcome").value("SURPLUS"))
        .andExpect(jsonPath("$.session.outsideTolerance").value(false));

    at(OPEN_AT.plusSeconds(3600));
    String shortage = openSession(w.worker(), "LUNCH", 20000);
    at(OPEN_AT.plusSeconds(7200));
    close(w.worker(), shortage, 17950, 20000, "Faltan 2.050 sin explicación", null)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.session.difference").value(-2050))
        .andExpect(jsonPath("$.session.outcome").value("SHORTAGE"))
        .andExpect(jsonPath("$.session.toleranceCop").value(2000))
        .andExpect(jsonPath("$.session.outsideTolerance").value(true))
        .andExpect(jsonPath("$.session.sequenceNumber").value(2));
  }

  @Test
  void ordersWithCentsBlockTheCloseAndAskForTheAdmin() throws Exception {
    var w = world();
    String session = openSession(w.worker(), "LUNCH", 0);
    order(w.cafeteria(), "DELIVERED", "13000.50", OPEN_AT.plusSeconds(60));
    at(OPEN_AT.plusSeconds(120));
    preview(w.worker(), session, 13000)
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.code").value("CASH_ORDER_TOTAL_NOT_WHOLE"))
        .andExpect(jsonPath("$.message", containsString("administrador")));
    close(w.worker(), session, 13000, 13000, null, null)
        .andExpect(jsonPath("$.code").value("CASH_ORDER_TOTAL_NOT_WHOLE"));
    assertEquals(
        "OPEN",
        jdbc.queryForObject(
            "SELECT status FROM public.cash_sessions WHERE id=?::uuid", String.class, session));
  }

  @Test
  void anExpenseCannotExceedTheDrawerAndARetryIsRecordedOnce() throws Exception {
    var w = world();
    String session = openSession(w.worker(), "LUNCH", 10000);
    movement(w.worker(), session, "EXPENSE", 10050, "Retiro grande")
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.code").value("CASH_EXPENSE_EXCEEDS_BALANCE"));
    UUID request = UUID.randomUUID();
    movement(w.worker(), session, request, "EXPENSE", 4000, "Consignación")
        .andExpect(status().isOk());
    movement(w.worker(), session, request, "EXPENSE", 4000, "Consignación")
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.movements.length()").value(1))
        .andExpect(jsonPath("$.live.expected").value(6000));
    movement(w.worker(), session, "INCOME", 1000, "x")
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("CASH_REASON_REQUIRED"));
    call(
            post("/api/cash/sessions/" + session + "/movements"),
            w.worker(),
            "{\"requestId\":\""
                + UUID.randomUUID()
                + "\",\"kind\":\"INCOME\",\"amount\":1000.5,\"reason\":\"Decimal\"}")
        .andExpect(jsonPath("$.code").value("CASH_INVALID_AMOUNT"));
    call(
            post("/api/cash/sessions"),
            w.admin(),
            "{\"shift\":\"LUNCH\",\"openingFloat\":0,\"cafeteriaId\":\""
                + UUID.randomUUID()
                + "\"}")
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("CASH_INVALID_REQUEST"));
  }

  // ---------------------------------------------------------------- pending orders and races

  @Test
  void readyOrCalledOrdersBlockTheCloseUnlessTheAdminForcesIt() throws Exception {
    var w = world();
    String session = openSession(w.worker(), "LUNCH", 10000);
    UUID called = order(w.cafeteria(), "CALLED", "13000", null);
    at(OPEN_AT.plusSeconds(600));
    close(w.worker(), session, 10000, 10000, null, null)
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.code").value("CASH_PENDING_ORDERS"))
        .andExpect(jsonPath("$.pendingOrders[0].id").value(called.toString()))
        .andExpect(jsonPath("$.pendingOrders[0].status").value("CALLED"));
    close(w.worker(), session, 10000, 10000, null, true)
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.code").value("CASH_FORBIDDEN"));
    close(w.admin(), session, 10000, 10000, null, true)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.session.forcedClose").value(true))
        .andExpect(jsonPath("$.session.pendingOrdersAtClose").value(1));
    var warning =
        jdbc.queryForObject(
            "SELECT new_value ->> 'forced_close' FROM public.cash_sessions_audit WHERE session_id=?::uuid AND action='CLOSED'",
            String.class,
            session);
    assertEquals("true", warning);
  }

  @Test
  void aDeliveryInFlightIsWaitedForAndChangesTheExpectedCash() throws Exception {
    var w = world();
    String session = openSession(w.worker(), "LUNCH", 10000);
    UUID called = order(w.cafeteria(), "CALLED", "13000", null);
    at(OPEN_AT.plusSeconds(600));
    try (Connection delivery = dataSource.getConnection()) {
      delivery.setAutoCommit(false);
      try (var statement =
          delivery.prepareStatement(
              "UPDATE public.orders SET status='DELIVERED', delivered_at=? WHERE id=?")) {
        statement.setTimestamp(1, Timestamp.from(OPEN_AT.plusSeconds(590)));
        statement.setObject(2, called);
        assertEquals(1, statement.executeUpdate());
      }
      // The cashier confirmed 10.000 before the sale: the close waits for the delivery's lock.
      var closing =
          CompletableFuture.supplyAsync(
              () -> {
                try {
                  return close(w.worker(), session, 10000, 10000, null, null).andReturn();
                } catch (Exception exception) {
                  throw new IllegalStateException(exception);
                }
              });
      Thread.sleep(800);
      assertFalse(closing.isDone(), "the close waits for the delivery in flight");
      delivery.commit();
      MvcResult refused = closing.get(20, TimeUnit.SECONDS);
      assertEquals(409, refused.getResponse().getStatus());
      assertEquals("CASH_EXPECTED_CHANGED", read(refused, "$.code"));
      assertEquals(13000, (int) read(refused, "$.preview.sales"));
      assertEquals(23000, (int) read(refused, "$.preview.expected"));
    }
    close(w.worker(), session, 23000, 23000, null, null)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.session.sales").value(13000));
  }

  @Test
  void aLongLockFailsFastWithARetryMessage() throws Exception {
    var w = world();
    String session = openSession(w.worker(), "LUNCH", 10000);
    UUID called = order(w.cafeteria(), "CALLED", "13000", null);
    at(OPEN_AT.plusSeconds(600));
    try (Connection delivery = dataSource.getConnection()) {
      delivery.setAutoCommit(false);
      try (var statement =
          delivery.prepareStatement("SELECT id FROM public.orders WHERE id=? FOR UPDATE")) {
        statement.setObject(1, called);
        statement.executeQuery().close();
      }
      long started = System.nanoTime();
      close(w.worker(), session, 10000, 10000, null, null)
          .andExpect(status().isConflict())
          .andExpect(jsonPath("$.code").value("CASH_BUSY"))
          .andExpect(header().string("Retry-After", "3"));
      Duration waited = Duration.ofNanos(System.nanoTime() - started);
      assertTrue(waited.toSeconds() < 10, "lock_timeout bounds the wait: " + waited);
      delivery.rollback();
    }
    assertEquals(
        "OPEN",
        jdbc.queryForObject(
            "SELECT status FROM public.cash_sessions WHERE id=?::uuid", String.class, session));
  }

  // ---------------------------------------------------------------- lifecycle

  @Test
  void aClosedSessionIsImmutableAndItsShiftCannotRepeat() throws Exception {
    var w = world();
    String session = openSession(w.worker(), "BREAKFAST", 10000);
    call(post("/api/cash/sessions"), w.worker(), "{\"shift\":\"LUNCH\",\"openingFloat\":0}")
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.code").value("CASH_SESSION_ALREADY_OPEN"));
    at(OPEN_AT.plusSeconds(60));
    close(w.worker(), session, 10000, 10000, null, null).andExpect(status().isOk());
    movement(w.worker(), session, "INCOME", 1000, "Tarde")
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.code").value("CASH_SESSION_CLOSED"));
    close(w.worker(), session, 10000, 10000, null, null)
        .andExpect(jsonPath("$.code").value("CASH_SESSION_CLOSED"));
    call(post("/api/cash/sessions"), w.worker(), "{\"shift\":\"BREAKFAST\",\"openingFloat\":0}")
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.code").value("CASH_SHIFT_ALREADY_USED"));
    openSession(w.worker(), "LUNCH", 0);
  }

  @Test
  void onlyTheAdminReopensTheLatestClosedSessionAndTheWindowExtends() throws Exception {
    var w = world();
    String first = openSession(w.worker(), "BREAKFAST", 10000);
    at(OPEN_AT.plusSeconds(600));
    close(w.worker(), first, 10000, 10000, null, null).andExpect(status().isOk());
    String second = openSession(w.worker(), "LUNCH", 5000);
    at(OPEN_AT.plusSeconds(1200));
    reopen(w.admin(), first, "Faltó registrar un retiro")
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.code").value("CASH_SESSION_ALREADY_OPEN"));
    close(w.worker(), second, 5000, 5000, null, null).andExpect(status().isOk());
    reopen(w.worker(), second, "Faltó registrar un retiro")
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.code").value("CASH_FORBIDDEN"));
    reopen(w.admin(), second, "corto")
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("CASH_REOPEN_REASON_REQUIRED"));
    reopen(w.admin(), first, "Faltó registrar un retiro")
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.code").value("CASH_REOPEN_NOT_LATEST"));
    // A sale after the close is a sale without a drawer until the reopen absorbs it.
    order(w.cafeteria(), "DELIVERED", "8000", OPEN_AT.plusSeconds(1500));
    at(OPEN_AT.plusSeconds(1800));
    reopen(w.admin(), second, "Faltó registrar un retiro")
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.session.status").value("REOPENED"))
        .andExpect(jsonPath("$.session.reopenCount").value(1))
        .andExpect(jsonPath("$.session.reopenedByName").value("Admin Central"))
        .andExpect(jsonPath("$.session.counted").doesNotExist());
    call(get("/api/cash/current"), w.worker(), null)
        .andExpect(jsonPath("$.session.id").value(second))
        .andExpect(jsonPath("$.live.sales").value(8000))
        .andExpect(jsonPath("$.unsessionedToday.orders").value(0));
    movement(w.worker(), second, "EXPENSE", 3000, "Retiro olvidado").andExpect(status().isOk());
    at(OPEN_AT.plusSeconds(2400));
    close(w.worker(), second, 10000, 10000, null, null)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.session.status").value("CLOSED"))
        .andExpect(jsonPath("$.session.sales").value(8000))
        .andExpect(jsonPath("$.session.expense").value(3000));
    var previous =
        jdbc.queryForMap(
            "SELECT old_value ->> 'counted_cash' AS counted, old_value -> 'countLines' AS lines, source"
                + " FROM public.cash_sessions_audit WHERE session_id=?::uuid AND action='REOPENED'",
            second);
    assertEquals("5000", previous.get("counted"));
    assertNotNull(previous.get("lines"));
    assertEquals("API", previous.get("source"));
  }

  @Test
  void aSessionLeftOpenYesterdayBlocksTodayAndAlertsTheAdmin() throws Exception {
    var w = world();
    String stale = openSession(w.worker(), "LUNCH", 10000);
    at(OPEN_AT.plus(Duration.ofDays(1)));
    call(post("/api/cash/sessions"), w.worker(), "{\"shift\":\"BREAKFAST\",\"openingFloat\":0}")
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.code").value("CASH_STALE_SESSION_OPEN"))
        .andExpect(jsonPath("$.message", containsString("2026-11-20")));
    call(get("/api/cash/current"), w.worker(), null)
        .andExpect(jsonPath("$.stale").value(true))
        .andExpect(jsonPath("$.session.id").value(stale));
    call(get("/api/cash/sessions?from=2026-11-20&to=2026-11-21"), w.admin(), null)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.staleSessions[0].id").value(stale))
        .andExpect(jsonPath("$.staleSessions[0].businessDate").value("2026-11-20"));
  }

  @Test
  void theBusinessDateIsTheBogotaDayAtTheMidnightEdge() throws Exception {
    var w = world();
    at(Instant.parse("2026-11-21T04:59:59Z")); // 23:59:59 on the 20th in Bogota
    String late = openSession(w.worker(), "LUNCH", 0);
    assertEquals(
        "2026-11-20",
        jdbc.queryForObject(
            "SELECT business_date::text FROM public.cash_sessions WHERE id=?::uuid",
            String.class,
            late));
    at(Instant.parse("2026-11-21T05:00:00Z"));
    close(w.worker(), late, 0, 0, null, null).andExpect(status().isOk());
    String early = openSession(w.worker(), "LUNCH", 0); // a new day: LUNCH is free again
    assertEquals(
        "2026-11-21",
        jdbc.queryForObject(
            "SELECT business_date::text FROM public.cash_sessions WHERE id=?::uuid",
            String.class,
            early));
  }

  // ---------------------------------------------------------------- isolation and roles

  @Test
  void eachCafeteriaSeesOnlyItsOwnDrawersAndSuperAdminOnlyReads() throws Exception {
    var central = world();
    var norte = world();
    String session = openSession(central.worker(), "LUNCH", 10000);
    // The other cafeteria cannot read, move or close it, and cannot tell it exists.
    call(get("/api/cash/sessions/" + session), norte.worker(), null)
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.code").value("CASH_SESSION_NOT_FOUND"));
    movement(norte.admin(), session, "INCOME", 1000, "Ajeno").andExpect(status().isNotFound());
    close(norte.admin(), session, 10000, 10000, null, true).andExpect(status().isNotFound());
    call(get("/api/cash/current"), norte.worker(), null)
        .andExpect(jsonPath("$.session").doesNotExist());
    call(get("/api/cash/sessions?from=2026-11-20&to=2026-11-20"), norte.admin(), null)
        .andExpect(jsonPath("$.sessions[*].id", not(hasItem(session))));
    // The list, export and tolerance belong to the ADMIN.
    call(get("/api/cash/sessions?from=2026-11-20&to=2026-11-20"), central.worker(), null)
        .andExpect(status().isForbidden());
    call(get("/api/cash/sessions?from=2026-11-01&to=2027-02-01"), central.admin(), null)
        .andExpect(status().isBadRequest());
    // SUPER_ADMIN reads every cafeteria but never operates.
    call(get("/api/super-admin/cash/sessions?from=2026-11-20&to=2026-11-20"), SUPER, null)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.sessions[*].id", hasItem(session)));
    call(get("/api/super-admin/cash/sessions/" + session), SUPER, null).andExpect(status().isOk());
    call(get("/api/cash/current"), SUPER, null).andExpect(status().isForbidden());
    movement(SUPER, session, "INCOME", 1000, "Global").andExpect(status().isForbidden());
    call(get("/api/super-admin/cash/sessions?from=2026-11-20&to=2026-11-20"), central.admin(), null)
        .andExpect(status().isForbidden());
    // An inactive worker loses access at once: no cached permissions.
    jdbc.update("UPDATE public.users SET is_active=false WHERE id=?", central.worker());
    call(get("/api/cash/current"), central.worker(), null).andExpect(status().isForbidden());
    // An identity with no row in the database.
    call(get("/api/cash/current"), UUID.randomUUID(), null).andExpect(status().isForbidden());
  }

  @Test
  void theAdminSetsAnAuditedToleranceAndExportsCsv() throws Exception {
    var w = world();
    call(put("/api/cash/settings"), w.worker(), "{\"toleranceCop\":5000,\"expectedVersion\":0}")
        .andExpect(status().isForbidden());
    call(put("/api/cash/settings"), w.admin(), "{\"toleranceCop\":5000,\"expectedVersion\":0}")
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.settingsVersion").value(1));
    call(put("/api/cash/settings"), w.admin(), "{\"toleranceCop\":3000,\"expectedVersion\":0}")
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.code").value("CASH_TOLERANCE_CHANGED"));
    var audit =
        jdbc.queryForMap(
            "SELECT new_value ->> 'toleranceCop' AS value, source, changed_by FROM public.cafeteria_settings_audit WHERE cafeteria_id=? AND setting='CASH_TOLERANCE'",
            w.cafeteria());
    assertEquals("5000", audit.get("value"));
    assertEquals("API", audit.get("source"));
    assertEquals(w.admin(), audit.get("changed_by"));

    String session = openSession(w.worker(), "LUNCH", 10000);
    at(OPEN_AT.plusSeconds(60));
    close(w.worker(), session, 7000, 10000, "Faltan 3.000 por revisar", null)
        .andExpect(jsonPath("$.session.toleranceCop").value(5000))
        .andExpect(jsonPath("$.session.outsideTolerance").value(false));
    var csv =
        call(get("/api/cash/sessions/export?from=2026-11-20&to=2026-11-20"), w.admin(), null)
            .andExpect(status().isOk())
            .andExpect(header().string("Content-Type", containsString("text/csv")))
            .andExpect(header().string("Content-Disposition", containsString("attachment")))
            .andReturn()
            .getResponse()
            .getContentAsByteArray();
    String text = new String(csv, StandardCharsets.UTF_8);
    assertTrue(text.startsWith("﻿Consecutivo;"));
    assertTrue(text.contains(";10000;0;0;0;10000;7000;-3000;Faltante;5000;No;No;"));
  }
}

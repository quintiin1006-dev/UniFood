package com.santotofood.config;

import static org.hamcrest.Matchers.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.santotofood.adapter.in.web.WorkerHistoryController;
import com.santotofood.adapter.in.web.error.GlobalExceptionHandler;
import com.santotofood.adapter.in.web.error.WorkerHistoryExceptionHandler;
import com.santotofood.adapter.out.persistence.AuthorizationPersistenceAdapter;
import com.santotofood.adapter.out.persistence.WorkerHistoryPersistenceAdapter;
import com.santotofood.application.service.WorkerHistoryService;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Proxy;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.SQLException;
import java.sql.SQLTransientConnectionException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.*;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import javax.sql.DataSource;
import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DelegatingDataSource;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.mock.web.MockServletContext;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.jwt.BadJwtException;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.transaction.annotation.EnableTransactionManagement;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.context.support.AnnotationConfigWebApplicationContext;
import org.springframework.web.servlet.config.annotation.EnableWebMvc;

/** Real migrated PostgreSQL, HTTP security, transaction, JDBC projection and snapshots. */
@Timeout(60)
class WorkerHistoryApiPostgresTest {
  static final String ENDPOINT = "/api/worker/orders/history/today";
  static final Instant START = Instant.parse("2026-10-13T05:00:00Z");
  static final Instant NEXT = Instant.parse("2026-10-14T05:00:00Z");
  static final UUID CAFE = UUID.randomUUID(), OTHER = UUID.randomUUID();
  static final UUID WORKER = UUID.randomUUID(), SECOND_WORKER = UUID.randomUUID();
  static final UUID INACTIVE = UUID.randomUUID(), UNASSIGNED = UUID.randomUUID();
  static final UUID LUNCH = UUID.randomUUID(), OTHER_LUNCH = UUID.randomUUID();
  static final UUID LEGACY_DELIVERED = UUID.randomUUID();
  static final UUID LEGACY_NOT_COLLECTED = UUID.randomUUID(), LEGACY_CANCELLED = UUID.randomUUID();
  static final UUID ADMIN = UUID.randomUUID(),
      CLIENT = UUID.randomUUID(),
      SUPER = UUID.randomUUID();
  static final AtomicReference<Instant> clock = new AtomicReference<>(START.plusSeconds(3600));
  static Process database;
  static TrackingDataSource source;
  static JdbcTemplate jdbc;
  static AnnotationConfigWebApplicationContext context;
  static MockMvc mvc;

  @Configuration
  @EnableWebMvc
  @EnableTransactionManagement
  static class TestConfig {
    @Bean
    DataSource dataSource() {
      return source;
    }

    @Bean
    JdbcTemplate jdbc(DataSource dataSource) {
      return new JdbcTemplate(dataSource);
    }

    @Bean
    DataSourceTransactionManager transactionManager(DataSource dataSource) {
      return new DataSourceTransactionManager(dataSource);
    }

    @Bean
    com.santotofood.domain.port.out.TimeProvider time() {
      return clock::get;
    }

    @Bean
    JwtDecoder jwtDecoder() {
      var decoder = mock(JwtDecoder.class);
      when(decoder.decode(anyString())).thenThrow(new BadJwtException("Invalid token"));
      return decoder;
    }
  }

  static class TrackingDataSource extends DelegatingDataSource {
    volatile boolean unavailable, unexpectedFailure, historyReadOnly;
    volatile int connectionsBeforeFailure = -1;
    String sessionZone = "UTC";
    final List<String> statements = new ArrayList<>();

    TrackingDataSource(DataSource target) {
      super(target);
    }

    @Override
    public Connection getConnection() throws SQLException {
      if (unavailable || connectionsBeforeFailure == 0)
        throw new SQLTransientConnectionException("PRIVATE_CONNECTION_DETAIL");
      if (connectionsBeforeFailure > 0) connectionsBeforeFailure--;
      Connection connection = super.getConnection();
      try (var setting = connection.prepareStatement("SELECT set_config('TimeZone',?,false)")) {
        setting.setString(1, sessionZone);
        setting.execute();
      }
      return (Connection)
          Proxy.newProxyInstance(
              Connection.class.getClassLoader(),
              new Class<?>[] {Connection.class},
              (proxy, method, args) -> {
                if (method.getName().equals("prepareStatement") && args[0] instanceof String sql) {
                  statements.add(sql);
                  if (sql.contains("WITH completed_orders")) {
                    historyReadOnly = connection.isReadOnly();
                    if (unexpectedFailure) throw new SQLException("PRIVATE_SQL_DETAIL", "XX000");
                  }
                }
                try {
                  return method.invoke(connection, args);
                } catch (InvocationTargetException exception) {
                  throw exception.getCause();
                }
              });
    }
  }

  @RestController
  static class UnrelatedController {
    @GetMapping("/api/test/history-unrelated")
    public String fail() {
      throw new IllegalStateException("PRIVATE_UNRELATED_DETAIL");
    }
  }

  @BeforeAll
  static void start() throws Exception {
    String bootstrap =
        """
        import { createNativeAuthDatabase, postgresBinaries }
          from '../unifood-web/tests/helpers/native-auth-database.mjs';
        const binaries = await postgresBinaries();
        if (!binaries) throw new Error('Native PostgreSQL required for worker history');
        const db = await createNativeAuthDatabase(binaries, { throughMigration: '013' });
        try {
          const port = await db.query('SHOW port');
          console.log(JSON.stringify({ url: `jdbc:postgresql://127.0.0.1:${port}/postgres` }));
          await new Promise(resolve => {
            process.stdin.once('data', resolve); process.stdin.once('end', resolve); process.stdin.resume();
          });
          process.stdin.destroy();
        } finally { await db.close(); }
        """;
    database =
        new ProcessBuilder("node", "--input-type=module", "-e", bootstrap)
            .redirectError(ProcessBuilder.Redirect.INHERIT)
            .start();
    String metadata =
        new BufferedReader(new InputStreamReader(database.getInputStream(), StandardCharsets.UTF_8))
            .readLine();
    assertNotNull(metadata, "Owned PostgreSQL helper must start");
    String url = metadata.substring(metadata.indexOf("jdbc:"), metadata.lastIndexOf('"'));
    assertTrue(url.startsWith("jdbc:postgresql://127.0.0.1:"));
    source = new TrackingDataSource(new DriverManagerDataSource(url, "postgres", ""));
    jdbc = new JdbcTemplate(source);
    seed();
    jdbc.execute(
        Files.readString(
            Path.of("supabase/migrations/014_order_cancellation_timestamp.sql"),
            StandardCharsets.UTF_8));
    context = new AnnotationConfigWebApplicationContext();
    context.setServletContext(new MockServletContext());
    context.register(
        TestConfig.class,
        SecurityConfig.class,
        OrderAuthorization.class,
        AuthorizationPersistenceAdapter.class,
        WorkerHistoryPersistenceAdapter.class,
        WorkerHistoryService.class,
        WorkerHistoryController.class,
        WorkerHistoryExceptionHandler.class,
        GlobalExceptionHandler.class,
        UnrelatedController.class);
    context.refresh();
    mvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
  }

  static void seed() {
    UUID site = UUID.randomUUID();
    jdbc.update(
        "INSERT INTO public.sites(id,name,city,institution_id) SELECT ?,'History tests','test',id FROM public.institutions LIMIT 1",
        site);
    for (UUID cafe : List.of(CAFE, OTHER)) {
      jdbc.update(
          "INSERT INTO public.cafeterias(id,site_id,name,is_active,lunch_order_start,lunch_order_end) VALUES (?,?,?,false,'07:00','08:00')",
          cafe,
          site,
          cafe.equals(CAFE) ? "Own history cafeteria" : "Other history cafeteria");
    }
    user(WORKER, "WORKER", CAFE, true);
    user(SECOND_WORKER, "WORKER", OTHER, true);
    user(INACTIVE, "WORKER", CAFE, false);
    user(UNASSIGNED, "WORKER", null, false);
    user(ADMIN, "ADMIN", CAFE, true);
    user(CLIENT, "CLIENT", null, true);
    user(SUPER, "SUPER_ADMIN", null, true);
    for (UUID item : List.of(LUNCH, OTHER_LUNCH))
      jdbc.update(
          "INSERT INTO public.lunches(id,cafeteria_id,name,price,stock,is_active,category) VALUES (?,?,'CURRENT_CATALOG_DETAIL',99000,0,false,'CORRIENTE')",
          item,
          item.equals(LUNCH) ? CAFE : OTHER);
    // Genuine existing terminal rows: 014 must preserve their unknown dates.
    for (var entry :
        Map.of(
                LEGACY_DELIVERED,
                "DELIVERED",
                LEGACY_NOT_COLLECTED,
                "NOT_COLLECTED",
                LEGACY_CANCELLED,
                "CANCELLED")
            .entrySet())
      jdbc.update(
          "INSERT INTO public.orders(id,cafeteria_id,client_name,total,status,created_at,updated_at) VALUES (?,?,'PRIVATE_CLIENT_DETAIL',10000,?::public.order_status,?,?)",
          entry.getKey(),
          CAFE,
          entry.getValue(),
          offset(START.minusSeconds(86400)),
          offset(START.plusSeconds(1)));
  }

  static void user(UUID id, String role, UUID cafe, boolean active) {
    jdbc.update("INSERT INTO auth.users(id,email) VALUES (?,?)", id, id + "@example.invalid");
    jdbc.update(
        "INSERT INTO public.user_roles(user_id,role_id) SELECT ?,id FROM public.roles WHERE name::text=?",
        id,
        role);
    if (cafe != null)
      jdbc.update(
          "INSERT INTO public.cafeteria_users(user_id,cafeteria_id) VALUES (?,?)", id, cafe);
    if (active) jdbc.update("UPDATE public.users SET is_active=true WHERE id=?", id);
  }

  @BeforeEach
  void reset() {
    source.unavailable = source.unexpectedFailure = false;
    source.connectionsBeforeFailure = -1;
    source.sessionZone = "UTC";
    clock.set(START.plusSeconds(3600));
    jdbc.update("DELETE FROM public.order_items");
    jdbc.update(
        "DELETE FROM public.orders WHERE id NOT IN (?,?,?)",
        LEGACY_DELIVERED,
        LEGACY_NOT_COLLECTED,
        LEGACY_CANCELLED);
    jdbc.update("UPDATE public.users SET is_active=true WHERE id=?", WORKER);
    source.statements.clear();
    source.historyReadOnly = false;
  }

  @AfterEach
  void restoreFailures() {
    source.unavailable = source.unexpectedFailure = false;
    source.connectionsBeforeFailure = -1;
    source.sessionZone = "UTC";
  }

  @AfterAll
  static void stop() throws Exception {
    if (context != null) context.close();
    if (database != null) {
      database.getOutputStream().write("stop\n".getBytes(StandardCharsets.UTF_8));
      database.getOutputStream().flush();
      assertTrue(database.waitFor(30, TimeUnit.SECONDS));
      assertEquals(0, database.exitValue());
    }
  }

  static OffsetDateTime offset(Instant instant) {
    return instant.atOffset(ZoneOffset.UTC);
  }

  static UUID order(String status, Instant completed) {
    return order(UUID.randomUUID(), CAFE, status, completed);
  }

  static UUID order(UUID id, UUID cafe, String status, Instant completed) {
    Instant delivered = status.equals("DELIVERED") ? completed : null;
    Instant notCollected = status.equals("NOT_COLLECTED") ? completed : null;
    Instant cancelled = status.equals("CANCELLED") ? completed : null;
    jdbc.update(
        "INSERT INTO public.orders(id,cafeteria_id,client_name,client_document,total,status,delivered_at,not_collected_at,cancelled_at,created_at,updated_at) VALUES (?,?,'Cliente de prueba','PRIVATE_DOCUMENT_DETAIL',10000,?::public.order_status,?,?,?,?,?)",
        id,
        cafe,
        status,
        delivered == null ? null : offset(delivered),
        notCollected == null ? null : offset(notCollected),
        cancelled == null ? null : offset(cancelled),
        offset(START.minusSeconds(86400)),
        offset(START.minusSeconds(86000)));
    return id;
  }

  static void item(UUID id, UUID order, String name, int quantity, int price) {
    jdbc.update(
        "INSERT INTO public.order_items(id,order_id,lunch_id,lunch_name,unit_price,quantity,subtotal,note) VALUES (?,?,?,?,?,?,?,'PRIVATE_NOTE_DETAIL')",
        id,
        order,
        LUNCH,
        name,
        price,
        quantity,
        price * quantity);
  }

  static RequestPostProcessor as(UUID user) {
    return jwt()
        .jwt(
            token ->
                token
                    .subject(user.toString())
                    .claim("role", "SUPER_ADMIN")
                    .claim("cafeteriaId", OTHER.toString()))
        .authorities(new SimpleGrantedAuthority("ROLE_SUPER_ADMIN"));
  }

  @ParameterizedTest
  @ValueSource(strings = {"DELIVERED", "NOT_COLLECTED", "CANCELLED"})
  void includesEachTerminalCreatedYesterdayButCompletedToday(String status) throws Exception {
    UUID id = order(status, START.plusSeconds(123));
    mvc.perform(get(ENDPOINT).with(as(WORKER)))
        .andExpect(status().isOk())
        .andExpect(header().string("Cache-Control", "no-store"))
        .andExpect(jsonPath("$.businessDate").value("2026-10-13"))
        .andExpect(jsonPath("$.nextBusinessDateAt").value(NEXT.toString()))
        .andExpect(jsonPath("$.orders", hasSize(1)))
        .andExpect(jsonPath("$.orders[0].id").value(id.toString()))
        .andExpect(jsonPath("$.orders[0].status").value(status))
        .andExpect(jsonPath("$.orders[0].completedAt").value(START.plusSeconds(123).toString()));
  }

  @ParameterizedTest
  @ValueSource(strings = {"PENDING", "PREPARING", "READY", "CALLED"})
  void operationalStatesAreExcludedEvenWithAnUnrelatedTerminalDate(String state) throws Exception {
    UUID id = order(state, null);
    jdbc.update(
        "UPDATE public.orders SET delivered_at=?,not_collected_at=? WHERE id=?",
        offset(START),
        offset(START),
        id);
    mvc.perform(get(ENDPOINT).with(as(WORKER)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.orders", hasSize(0)));
  }

  @ParameterizedTest
  @ValueSource(strings = {"DELIVERED", "NOT_COLLECTED", "CANCELLED"})
  void rejectsYesterdayTomorrowAndOtherCafeteriaForEveryTerminal(String state) throws Exception {
    order(state, START.minusNanos(1000));
    order(state, NEXT);
    order(UUID.randomUUID(), OTHER, state, START.plusSeconds(5));
    mvc.perform(get(ENDPOINT).with(as(WORKER)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.orders", hasSize(0)));
  }

  @ParameterizedTest
  @ValueSource(strings = {"DELIVERED", "NOT_COLLECTED", "CANCELLED"})
  void bogotaRangeIncludesStartAndExcludesNextStart(String state) throws Exception {
    UUID lower = order(state, START);
    UUID upper = order(state, NEXT.minusNanos(1000));
    order(state, START.minusNanos(1000));
    order(state, NEXT);
    mvc.perform(get(ENDPOINT).with(as(WORKER)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.orders", hasSize(2)))
        .andExpect(jsonPath("$.orders[0].id").value(upper.toString()))
        .andExpect(jsonPath("$.orders[1].id").value(lower.toString()));
  }

  @Test
  void unknownLegacyTimestampsRemainStoredAndExcludedWithoutFallback() throws Exception {
    String before = snapshots();
    mvc.perform(get(ENDPOINT).with(as(WORKER)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.orders", hasSize(0)));
    assertEquals(before, snapshots());
    assertEquals(3, jdbc.queryForObject("SELECT count(*) FROM public.orders", Integer.class));
  }

  @ParameterizedTest
  @CsvSource({"DELIVERED,not_collected_at", "NOT_COLLECTED,delivered_at", "CANCELLED,delivered_at"})
  void onlyTheTimestampMatchingTheCurrentStatusDefinesTheDay(String state, String unrelated)
      throws Exception {
    UUID id = order(state, START.minusSeconds(1));
    // Column names are fixed test constants, never request data.
    jdbc.update(
        "UPDATE public.orders SET " + unrelated + "=? WHERE id=?",
        offset(START.plusSeconds(30)),
        id);
    mvc.perform(get(ENDPOINT).with(as(WORKER)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.orders", hasSize(0)));
  }

  @Test
  void stableOrderAndSnapshotsUseOneReadQueryWithoutPrivateClientDataOrCatalogLookups()
      throws Exception {
    UUID older = order("CANCELLED", START);
    UUID low =
        order(
            UUID.fromString("00000000-0000-0000-0000-000000000001"),
            CAFE,
            "NOT_COLLECTED",
            START.plusSeconds(20));
    UUID high =
        order(
            UUID.fromString("ffffffff-ffff-ffff-ffff-ffffffffffff"),
            CAFE,
            "DELIVERED",
            START.plusSeconds(20));
    item(
        UUID.fromString("00000000-0000-0000-0000-000000000002"),
        high,
        "Historical second",
        1,
        4000);
    item(
        UUID.fromString("00000000-0000-0000-0000-000000000001"), high, "Historical first", 2, 3000);
    item(UUID.randomUUID(), low, "Another snapshot", 1, 10000);
    String before = snapshots();
    source.statements.clear();
    var result =
        mvc.perform(get(ENDPOINT).with(as(WORKER)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.length()").value(3))
            .andExpect(jsonPath("$.orders", hasSize(3)))
            .andExpect(jsonPath("$.orders[0].id").value(high.toString()))
            .andExpect(jsonPath("$.orders[1].id").value(low.toString()))
            .andExpect(jsonPath("$.orders[2].id").value(older.toString()))
            .andExpect(jsonPath("$.orders[0].reference").value("Pedido · FFFFFFFF"))
            .andExpect(jsonPath("$.orders[0].length()").value(7))
            .andExpect(jsonPath("$.orders[0].clientName").value("Cliente de prueba"))
            .andExpect(jsonPath("$.orders[0].total").value(10000))
            .andExpect(jsonPath("$.orders[0].items", hasSize(2)))
            .andExpect(jsonPath("$.orders[0].items[0].length()").value(4))
            .andExpect(jsonPath("$.orders[0].items[0].name").value("Historical first"))
            .andExpect(jsonPath("$.orders[0].items[0].quantity").value(2))
            .andExpect(jsonPath("$.orders[0].items[0].unitPrice").value(3000))
            .andExpect(jsonPath("$.orders[0].items[0].subtotal").value(6000))
            .andExpect(jsonPath("$.orders[0].items[1].name").value("Historical second"))
            .andExpect(jsonPath("$.orders[2].items", hasSize(0)))
            .andReturn();
    assertEquals(
        2,
        source.statements.size(),
        "One authorization SELECT and one history SELECT, regardless of items/orders");
    assertEquals(
        1, source.statements.stream().filter(sql -> sql.contains("WITH completed_orders")).count());
    assertTrue(source.historyReadOnly);
    assertTrue(source.statements.stream().noneMatch(sql -> sql.contains("FROM public.lunches")));
    assertFalse(result.getResponse().getContentAsString().contains("PRIVATE_"));
    assertFalse(result.getResponse().getContentAsString().contains("CURRENT_CATALOG_DETAIL"));
    assertEquals(before, snapshots());
  }

  @Test
  void namesComeFromTheirOwnOrderWithoutExposingOtherCafeteriasOrPrivateClientData()
      throws Exception {
    UUID own = order("DELIVERED", START);
    UUID unnamed = order("CANCELLED", START.plusSeconds(1));
    UUID foreign = order(UUID.randomUUID(), OTHER, "NOT_COLLECTED", START.plusSeconds(2));
    jdbc.update("UPDATE public.orders SET client_name=? WHERE id=?", "Juan Pérez", own);
    jdbc.update("UPDATE public.orders SET client_name=' ' WHERE id=?", unnamed);
    jdbc.update(
        "UPDATE public.orders SET client_name=? WHERE id=?", "Cliente de otra cafetería", foreign);
    source.statements.clear();
    var response =
        mvc.perform(get(ENDPOINT).with(as(WORKER)).param("clientId", foreign.toString()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.orders", hasSize(2)))
            .andExpect(jsonPath("$.orders[0].id").value(unnamed.toString()))
            .andExpect(jsonPath("$.orders[0].clientName").value(nullValue()))
            .andExpect(jsonPath("$.orders[1].id").value(own.toString()))
            .andExpect(jsonPath("$.orders[1].clientName").value("Juan Pérez"))
            .andExpect(jsonPath("$.orders[1].clientId").doesNotExist())
            .andExpect(jsonPath("$.orders[1].clientDocument").doesNotExist())
            .andExpect(jsonPath("$.orders[1].email").doesNotExist())
            .andExpect(jsonPath("$.orders[1].phone").doesNotExist())
            .andReturn()
            .getResponse()
            .getContentAsString();
    assertFalse(response.contains("Cliente de otra cafetería"));
    assertFalse(response.contains("PRIVATE_"));
    assertFalse(response.contains(WORKER.toString()));
    assertEquals(2, source.statements.size());
    assertTrue(
        source.statements.stream()
            .noneMatch(sql -> sql.contains("public.clients") || sql.contains("auth.users")));
    mvc.perform(get(ENDPOINT).with(as(SECOND_WORKER)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.orders", hasSize(1)))
        .andExpect(jsonPath("$.orders[0].clientName").value("Cliente de otra cafetería"));
  }

  @Test
  void queryCountStaysConstantWhenTheDailyHistoryGrows() throws Exception {
    for (int index = 0; index < 12; index++) {
      UUID id = order("DELIVERED", START.plusSeconds(index));
      item(UUID.randomUUID(), id, "Snapshot", 2, 5000);
    }
    source.statements.clear();
    mvc.perform(get(ENDPOINT).with(as(WORKER)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.orders", hasSize(12)));
    assertEquals(2, source.statements.size());
  }

  @Test
  void browserOverridesAndJwtClaimsNeverChangeTheAuthorizedIdentityOrDay() throws Exception {
    UUID own = order("DELIVERED", START);
    order(UUID.randomUUID(), OTHER, "DELIVERED", START.plusSeconds(1));
    mvc.perform(
            get(ENDPOINT)
                .with(as(WORKER))
                .param("cafeteriaId", OTHER.toString())
                .param("userId", SECOND_WORKER.toString())
                .param("date", "2026-10-12")
                .param("states", "PENDING"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.businessDate").value("2026-10-13"))
        .andExpect(jsonPath("$.orders", hasSize(1)))
        .andExpect(jsonPath("$.orders[0].id").value(own.toString()));
  }

  @ParameterizedTest
  @ValueSource(strings = {"CLIENT", "ADMIN", "SUPER_ADMIN", "INACTIVE", "UNASSIGNED", "UNKNOWN"})
  void otherRolesAndInvalidProfilesAreForbiddenDespiteWorkerClaims(String identity)
      throws Exception {
    UUID user =
        switch (identity) {
          case "CLIENT" -> CLIENT;
          case "ADMIN" -> ADMIN;
          case "SUPER_ADMIN" -> SUPER;
          case "INACTIVE" -> INACTIVE;
          case "UNASSIGNED" -> UNASSIGNED;
          default -> UUID.randomUUID();
        };
    mvc.perform(
            get(ENDPOINT)
                .with(jwt().jwt(token -> token.subject(user.toString()).claim("role", "WORKER"))))
        .andExpect(status().isForbidden())
        .andExpect(header().string("Cache-Control", "no-store"))
        .andExpect(jsonPath("$.code").value("WORKER_HISTORY_FORBIDDEN"))
        .andExpect(content().string(not(containsString(user.toString()))));
  }

  @Test
  void authorizationReadsCurrentDatabaseFactsOnEveryRequest() throws Exception {
    mvc.perform(get(ENDPOINT).with(as(WORKER))).andExpect(status().isOk());
    jdbc.update("UPDATE public.users SET is_active=false WHERE id=?", WORKER);
    mvc.perform(get(ENDPOINT).with(as(WORKER))).andExpect(status().isForbidden());
  }

  @Test
  void anotherWorkerSeesOnlyTheirOwnCafeteria() throws Exception {
    order("DELIVERED", START);
    UUID foreign = order(UUID.randomUUID(), OTHER, "CANCELLED", START);
    mvc.perform(get(ENDPOINT).with(as(SECOND_WORKER)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.orders", hasSize(1)))
        .andExpect(jsonPath("$.orders[0].id").value(foreign.toString()));
  }

  @Test
  void absentOrInvalidBearerAuthenticationIsUnauthorized() throws Exception {
    mvc.perform(get(ENDPOINT)).andExpect(status().isUnauthorized());
    mvc.perform(get(ENDPOINT).header("Authorization", "Bearer invalid"))
        .andExpect(status().isUnauthorized());
  }

  @Test
  void businessMidnightSwitchesTheDayWithoutChangingStoredOrders() throws Exception {
    UUID yesterday = order("CANCELLED", NEXT.minusNanos(1000));
    UUID today = order("DELIVERED", NEXT);
    String before = snapshots();
    clock.set(NEXT.minusNanos(1));
    mvc.perform(get(ENDPOINT).with(as(WORKER)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.businessDate").value("2026-10-13"))
        .andExpect(jsonPath("$.orders[0].id").value(yesterday.toString()));
    clock.set(NEXT);
    mvc.perform(get(ENDPOINT).with(as(WORKER)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.businessDate").value("2026-10-14"))
        .andExpect(jsonPath("$.nextBusinessDateAt").value("2026-10-15T05:00:00Z"))
        .andExpect(jsonPath("$.orders", hasSize(1)))
        .andExpect(jsonPath("$.orders[0].id").value(today.toString()));
    assertEquals(before, snapshots());
  }

  @ParameterizedTest
  @ValueSource(strings = {"UTC", "Asia/Tokyo", "America/Los_Angeles"})
  void hostAndPostgresTimeZonesCannotChooseTheBusinessDay(String zone) throws Exception {
    var previous = TimeZone.getDefault();
    try {
      TimeZone.setDefault(TimeZone.getTimeZone(zone));
      source.sessionZone = zone;
      UUID id = order("NOT_COLLECTED", START);
      clock.set(START);
      mvc.perform(get(ENDPOINT).with(as(WORKER)))
          .andExpect(status().isOk())
          .andExpect(jsonPath("$.businessDate").value("2026-10-13"))
          .andExpect(jsonPath("$.nextBusinessDateAt").value(NEXT.toString()))
          .andExpect(jsonPath("$.orders[0].id").value(id.toString()))
          .andExpect(jsonPath("$.orders[0].completedAt").value(START.toString()));
    } finally {
      TimeZone.setDefault(previous);
    }
  }

  @ParameterizedTest
  @ValueSource(booleans = {false, true})
  void temporaryFailuresDuringAuthorizationOrReadReturn503AndRecover(boolean afterAuthorization)
      throws Exception {
    UUID id = order("DELIVERED", START);
    if (afterAuthorization) source.connectionsBeforeFailure = 1;
    else source.unavailable = true;
    var failed =
        mvc.perform(get(ENDPOINT).with(as(WORKER)))
            .andExpect(status().isServiceUnavailable())
            .andExpect(header().string("Cache-Control", "no-store"))
            .andExpect(header().string("Retry-After", "5"))
            .andExpect(header().doesNotExist("Set-Cookie"))
            .andExpect(jsonPath("$.code").value("WORKER_HISTORY_TEMPORARILY_UNAVAILABLE"))
            .andExpect(content().string(not(containsString("PRIVATE_"))))
            .andReturn();
    assertFalse(failed.getResponse().getContentAsString().contains("SELECT"));
    source.unavailable = false;
    source.connectionsBeforeFailure = -1;
    mvc.perform(get(ENDPOINT).with(as(WORKER)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.orders[0].id").value(id.toString()));
  }

  @Test
  void unexpectedSqlFailureIsSafe500() throws Exception {
    source.unexpectedFailure = true;
    mvc.perform(get(ENDPOINT).with(as(WORKER)))
        .andExpect(status().isInternalServerError())
        .andExpect(header().string("Cache-Control", "no-store"))
        .andExpect(header().doesNotExist("Retry-After"))
        .andExpect(jsonPath("$.code").value("WORKER_HISTORY_INTERNAL_ERROR"))
        .andExpect(content().string(not(containsString("PRIVATE_SQL_DETAIL"))))
        .andExpect(content().string(not(containsString("SELECT"))));
  }

  @Test
  void unrelatedControllersKeepTheExistingGlobalErrorContract() throws Exception {
    mvc.perform(get("/api/test/history-unrelated").with(as(WORKER)))
        .andExpect(status().isInternalServerError())
        .andExpect(jsonPath("$.code").value("INTERNAL_ERROR"))
        .andExpect(content().string(not(containsString("PRIVATE_UNRELATED_DETAIL"))));
  }

  static String snapshots() {
    return jdbc.queryForObject(
        "SELECT jsonb_agg(to_jsonb(o) ORDER BY id)::text FROM public.orders o", String.class);
  }
}

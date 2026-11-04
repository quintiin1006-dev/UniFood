package com.santotofood.config;

import static org.hamcrest.Matchers.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.jayway.jsonpath.JsonPath;
import com.santotofood.adapter.in.web.AdminDashboardController;
import com.santotofood.adapter.in.web.error.AdminDashboardExceptionHandler;
import com.santotofood.adapter.in.web.error.GlobalExceptionHandler;
import com.santotofood.adapter.out.persistence.AdminDashboardPersistenceAdapter;
import com.santotofood.adapter.out.persistence.AuthorizationPersistenceAdapter;
import com.santotofood.application.service.AdminDashboardService;
import com.santotofood.domain.port.out.TimeProvider;
import jakarta.persistence.EntityManagerFactory;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Proxy;
import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.sql.*;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.TimeUnit;
import javax.sql.DataSource;
import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DelegatingDataSource;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.mock.web.MockServletContext;
import org.springframework.orm.jpa.JpaTransactionManager;
import org.springframework.orm.jpa.LocalContainerEntityManagerFactoryBean;
import org.springframework.orm.jpa.persistenceunit.PersistenceManagedTypes;
import org.springframework.orm.jpa.vendor.HibernateJpaVendorAdapter;
import org.springframework.security.oauth2.jwt.BadJwtException;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.transaction.annotation.EnableTransactionManagement;
import org.springframework.web.context.support.AnnotationConfigWebApplicationContext;
import org.springframework.web.servlet.config.annotation.EnableWebMvc;

/** Owns a temporary loopback-only PostgreSQL cluster; never reads a developer database URL. */
@Timeout(90)
class AdminDashboardApiPostgresTest {
  static final String ENDPOINT = "/api/admin/dashboard";
  static final Instant NOW = Instant.parse("2026-10-24T17:00:00Z");
  static final UUID CAFE = UUID.randomUUID(), OTHER = UUID.randomUUID();
  static final UUID ADMIN = UUID.randomUUID(), SECOND = UUID.randomUUID();
  static final UUID WORKER = UUID.randomUUID(),
      CLIENT = UUID.randomUUID(),
      INACTIVE = UUID.randomUUID();
  static final UUID P1 = UUID.fromString("10000000-0000-0000-0000-000000000001");
  static final UUID P2 = UUID.fromString("10000000-0000-0000-0000-000000000002");
  static Process database;
  static TrackingSource source;
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
    JdbcTemplate jdbc(DataSource ds) {
      return new JdbcTemplate(ds);
    }

    @Bean
    TimeProvider timeProvider() {
      return () -> NOW;
    }

    @Bean
    LocalContainerEntityManagerFactoryBean entityManagerFactory(DataSource ds) {
      var factory = new LocalContainerEntityManagerFactoryBean();
      factory.setDataSource(ds);
      factory.setJpaVendorAdapter(new HibernateJpaVendorAdapter());
      factory.setManagedTypes(PersistenceManagedTypes.of());
      factory.setJpaPropertyMap(Map.of("hibernate.hbm2ddl.auto", "none"));
      return factory;
    }

    @Bean
    JpaTransactionManager transactionManager(EntityManagerFactory factory) {
      return new JpaTransactionManager(factory);
    }

    @Bean
    JwtDecoder jwtDecoder() {
      var decoder = mock(JwtDecoder.class);
      when(decoder.decode(anyString())).thenThrow(new BadJwtException("PRIVATE_TOKEN_DETAIL"));
      return decoder;
    }
  }

  static class TrackingSource extends DelegatingDataSource {
    String failure = "";
    final List<String> sql = new ArrayList<>();
    final List<Connection> connections = new ArrayList<>();
    boolean readOnly = true;
    boolean repeatable = true;

    TrackingSource(DataSource target) {
      super(target);
    }

    @Override
    public Connection getConnection() throws SQLException {
      if (failure.equals("connection"))
        throw new SQLTransientConnectionException("PRIVATE_CONNECTION");
      Connection connection = super.getConnection();
      return (Connection)
          Proxy.newProxyInstance(
              Connection.class.getClassLoader(),
              new Class<?>[] {Connection.class},
              (proxy, method, args) -> {
                if (method.getName().equals("prepareStatement")
                    && args[0] instanceof String statement) {
                  sql.add(statement);
                  connections.add(connection);
                  readOnly &= connection.isReadOnly();
                  repeatable &=
                      connection.getTransactionIsolation()
                          == Connection.TRANSACTION_REPEATABLE_READ;
                  if (statement.contains("AS roles") && failure.equals("authorization"))
                    throw new SQLTransientConnectionException("PRIVATE_AUTH", "08006");
                  if (statement.contains("WITH candidates")) {
                    if (failure.equals("query"))
                      throw new SQLTransientConnectionException("PRIVATE_QUERY", "08006");
                    if (failure.equals("timeout"))
                      throw new SQLTimeoutException("PRIVATE_TIMEOUT", "57014");
                    if (failure.equals("unexpected"))
                      throw new SQLException("PRIVATE_SQL", "XX000");
                  }
                }
                try {
                  return method.invoke(connection, args);
                } catch (InvocationTargetException exception) {
                  throw exception.getCause();
                }
              });
    }

    void reset() {
      failure = "";
      sql.clear();
      connections.clear();
      readOnly = repeatable = true;
    }
  }

  @BeforeAll
  static void start() throws Exception {
    String bootstrap =
        """
        import { createNativeAuthDatabase, postgresBinaries }
          from '../unifood-web/tests/helpers/native-auth-database.mjs';
        const binaries = await postgresBinaries();
        if (!binaries) throw new Error('Isolated native PostgreSQL required for dashboard tests');
        const db = await createNativeAuthDatabase(binaries, { throughMigration: '017' });
        try {
          console.log(JSON.stringify({ url: `jdbc:postgresql://127.0.0.1:${await db.query('SHOW port')}/postgres` }));
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
    assertNotNull(metadata, "Isolated cluster must start; no external database fallback");
    String url = metadata.substring(metadata.indexOf("jdbc:"), metadata.lastIndexOf('"'));
    assertTrue(url.matches("jdbc:postgresql://127\\.0\\.0\\.1:[0-9]+/postgres"));
    source = new TrackingSource(new DriverManagerDataSource(url, "postgres", ""));
    jdbc = new JdbcTemplate(source);
    seedIdentity();
    context = new AnnotationConfigWebApplicationContext();
    context.setServletContext(new MockServletContext());
    context.register(
        TestConfig.class,
        SecurityConfig.class,
        AdminDashboardSecurityConfig.class,
        AuthorizationPersistenceAdapter.class,
        AdminDashboardPersistenceAdapter.class,
        AdminDashboardService.class,
        AdminDashboardController.class,
        AdminDashboardExceptionHandler.class,
        GlobalExceptionHandler.class);
    context.refresh();
    mvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
  }

  static void seedIdentity() {
    UUID institution = UUID.randomUUID(), site = UUID.randomUUID();
    jdbc.update(
        "INSERT INTO public.institutions(id,name,email_domain,brand_name) VALUES (?,'Test',?,'Test')",
        institution,
        institution + ".example.invalid");
    jdbc.update(
        "INSERT INTO public.sites(id,name,city,institution_id) VALUES (?,'Site','Test',?)",
        site,
        institution);
    for (UUID cafe : List.of(CAFE, OTHER))
      jdbc.update(
          "INSERT INTO public.cafeterias(id,site_id,name,is_active,lunch_order_start,lunch_order_end) VALUES (?,?,?,false,'07:00','08:00')",
          cafe,
          site,
          cafe.toString());
    user(ADMIN, "ADMIN", CAFE, true);
    user(SECOND, "ADMIN", OTHER, true);
    user(WORKER, "WORKER", CAFE, true);
    user(CLIENT, "CLIENT", null, true);
    user(INACTIVE, "ADMIN", null, false);
    jdbc.update("UPDATE public.cafeterias SET is_active=true WHERE id=?", CAFE);
    product(P1, CAFE);
    product(P2, CAFE);
  }

  static void user(UUID id, String role, UUID cafe, boolean active) {
    jdbc.update(
        "INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES (?,?,'{}')",
        id,
        id + "@example.invalid");
    jdbc.update(
        "INSERT INTO public.user_roles(user_id,role_id) SELECT ?,id FROM public.roles WHERE name::text=?",
        id,
        role);
    if (cafe != null)
      jdbc.update(
          "INSERT INTO public.cafeteria_users(user_id,cafeteria_id) VALUES (?,?)", id, cafe);
    if (active) jdbc.update("UPDATE public.users SET is_active=true WHERE id=?", id);
  }

  static void product(UUID id, UUID cafe) {
    jdbc.update(
        "INSERT INTO public.lunches(id,cafeteria_id,name,price,category,is_active) VALUES (?,?,?,999,'ESPECIAL',false)",
        id,
        cafe,
        "CURRENT_NAME_" + id);
  }

  static UUID order(
      UUID cafe,
      String status,
      String created,
      String delivered,
      String notCollected,
      String total) {
    UUID id = UUID.randomUUID();
    jdbc.update(
        "INSERT INTO public.orders(id,cafeteria_id,client_name,client_document,status,total,created_at,delivered_at,not_collected_at,cancelled_at) VALUES (?,?,'PRIVATE_STUDENT','PRIVATE_DOCUMENT',CAST(? AS public.order_status),CAST(? AS numeric),CAST(? AS timestamptz),CAST(? AS timestamptz),CAST(? AS timestamptz),CASE WHEN ?='CANCELLED' THEN CAST(? AS timestamptz) ELSE NULL END)",
        id,
        cafe,
        status,
        total,
        created,
        delivered,
        notCollected,
        status,
        "2026-10-24T10:00:00Z");
    return id;
  }

  static void item(UUID order, UUID product, int quantity, String name) {
    item(UUID.randomUUID(), order, product, quantity, name);
  }

  static void item(UUID id, UUID order, UUID product, int quantity, String name) {
    jdbc.update(
        "INSERT INTO public.order_items(id,order_id,lunch_id,lunch_name,quantity,unit_price,subtotal,note) VALUES (?,?,?,?,?,10,CAST(? AS numeric)*10,'PRIVATE_NOTE')",
        id,
        order,
        product,
        name,
        quantity,
        quantity);
  }

  @BeforeEach
  void reset() {
    source.reset();
    // Only tables in this test-owned temporary cluster are changed.
    jdbc.update("DELETE FROM public.order_items");
    jdbc.update("DELETE FROM public.orders");
    source.reset();
  }

  @AfterEach
  void restore() {
    source.failure = "";
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

  static ResultActions call(UUID user) throws Exception {
    return mvc.perform(
        get(ENDPOINT)
            .param("range", "TODAY")
            .with(
                jwt()
                    .jwt(
                        token ->
                            token
                                .subject(user.toString())
                                .claim("role", "ADMIN")
                                .claim("cafeteriaId", OTHER.toString()))));
  }

  @Test
  void eventsSnapshotsReconciliationAndDistinctOrders() throws Exception {
    UUID delivered =
        order(CAFE, "DELIVERED", "2026-10-23T12:00:00Z", "2026-10-24T06:00:00Z", null, "99");
    item(
        UUID.fromString("20000000-0000-0000-0000-000000000001"),
        delivered,
        P1,
        2,
        "Older snapshot");
    item(
        UUID.fromString("20000000-0000-0000-0000-000000000002"),
        delivered,
        P1,
        1,
        "Latest snapshot");
    item(delivered, P2, 1, "Other snapshot");
    UUID notCollected =
        order(CAFE, "NOT_COLLECTED", "2026-10-23T12:00:00Z", null, "2026-10-24T07:00:00Z", "30");
    item(notCollected, P1, 1, "A");
    item(notCollected, P2, 2, "B");
    item(order(CAFE, "PENDING", "2026-10-24T05:00:00Z", null, null, "10"), P1, 1, "A");
    item(order(CAFE, "CANCELLED", "2026-10-24T09:00:00Z", null, null, "10"), P1, 1, "A");
    order(OTHER, "DELIVERED", "2026-10-23T12:00:00Z", "2026-10-24T06:00:00Z", null, "999");
    // Exactly at the current cutoff: excluded.
    order(CAFE, "DELIVERED", "2026-10-23T12:00:00Z", NOW.toString(), null, "100");
    source.reset();
    var result =
        call(ADMIN)
            .andExpect(status().isOk())
            .andExpect(header().string("Cache-Control", "no-store"))
            .andExpect(jsonPath("$.summary.receivedOrders").value("2"))
            .andExpect(jsonPath("$.summary.deliveredOrders").value("1"))
            .andExpect(jsonPath("$.summary.notCollectedOrders").value("1"))
            .andExpect(jsonPath("$.summary.receivedOrderValue").value("20.00"))
            .andExpect(jsonPath("$.summary.deliveredOrderValue").value("99.00"))
            .andExpect(jsonPath("$.summary.notCollectedItemValue").value("30.00"))
            .andExpect(jsonPath("$.summary.notCollectedUnits").value("3"))
            .andExpect(jsonPath("$.summary.notCollectedRatePercent").value("50.00"))
            .andExpect(jsonPath("$.topDeliveredProducts.totals.orders").value("1"))
            .andExpect(jsonPath("$.topDeliveredProducts.totals.itemValue").value("40.00"))
            .andExpect(jsonPath("$.topDeliveredProducts.items[0].units").value("3"))
            .andExpect(jsonPath("$.topDeliveredProducts.items[0].orders").value("1"))
            .andExpect(
                jsonPath("$.topDeliveredProducts.items[0].historicalName").value("Latest snapshot"))
            .andExpect(jsonPath("$.notCollectedProducts.items[0].unitSharePercent").value("66.67"))
            .andExpect(
                jsonPath("$.coverage.warnings[?(@.code=='HEADER_ITEM_MISMATCH_DELIVERED')]")
                    .isNotEmpty())
            .andReturn();
    String body = result.getResponse().getContentAsString();
    for (String privateField :
        List.of(
            "PRIVATE_",
            "CURRENT_NAME_",
            "clientName",
            "clientDocument",
            "clientId",
            "orderId",
            "@example.invalid")) assertFalse(body.contains(privateField), privateField);
    assertEquals(7, source.sql.size());
    assertTrue(source.readOnly);
    assertTrue(source.repeatable);
    assertTrue(source.connections.stream().allMatch(c -> c == source.connections.getFirst()));
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "EMPTY",
        "NORMAL",
        "INCOMPLETE",
        "BAD_DATES",
        "UNKNOWN_NAME",
        "LARGE",
        "NAN_HEADER"
      })
  void springSerializedResponseMatchesRealTypeScriptContract(String scenario) throws Exception {
    switch (scenario) {
      case "NORMAL" -> {
        item(
            order(CAFE, "DELIVERED", "2026-10-23T12:00:00Z", "2026-10-24T06:00:00Z", null, "20"),
            P1,
            2,
            "Delivered");
        item(
            order(
                CAFE, "NOT_COLLECTED", "2026-10-23T12:00:00Z", null, "2026-10-24T07:00:00Z", "30"),
            P2,
            3,
            "Not collected");
      }
      case "INCOMPLETE" ->
          order(CAFE, "NOT_COLLECTED", "2026-10-23T12:00:00Z", null, "2026-10-24T07:00:00Z", "30");
      case "BAD_DATES" -> order(CAFE, "DELIVERED", "2026-10-24T06:00:00Z", null, null, "10");
      case "UNKNOWN_NAME" ->
          item(
              order(CAFE, "DELIVERED", "2026-10-23T12:00:00Z", "2026-10-24T06:00:00Z", null, "10"),
              P1,
              1,
              "   ");
      case "LARGE" -> {
        UUID order =
            order(CAFE, "NOT_COLLECTED", "2026-10-23T12:00:00Z", null, "2026-10-24T07:00:00Z", "0");
        for (int i = 0; i < 5; i++) item(order, P1, 600_000_000, "Large");
      }
      case "NAN_HEADER" ->
          item(
              order(CAFE, "DELIVERED", "2026-10-23T12:00:00Z", "2026-10-24T06:00:00Z", null, "NaN"),
              P1,
              1,
              "Historical");
      default -> {
        /* EMPTY */
      }
    }
    String json =
        call(ADMIN).andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
    Process validator =
        new ProcessBuilder("node", "tests/helpers/assert-admin-dashboard-contract.mjs")
            .directory(Path.of("../unifood-web").toFile())
            .redirectError(ProcessBuilder.Redirect.INHERIT)
            .start();
    try {
      try (var input = validator.getOutputStream()) {
        input.write(json.getBytes(StandardCharsets.UTF_8));
      }
      assertTrue(validator.waitFor(20, TimeUnit.SECONDS), "TypeScript validator timed out");
      assertEquals(0, validator.exitValue(), "TypeScript rejected Spring DTO: " + scenario);
      assertEquals(
          "OK", new String(validator.getInputStream().readAllBytes(), StandardCharsets.UTF_8));
    } finally {
      if (validator.isAlive()) validator.destroyForcibly();
    }
  }

  @ParameterizedTest
  @ValueSource(strings = {"CLIENT", "WORKER", "INACTIVE", "UNKNOWN"})
  void invalidBusinessIdentityIs403(String kind) throws Exception {
    UUID user =
        switch (kind) {
          case "CLIENT" -> CLIENT;
          case "WORKER" -> WORKER;
          case "INACTIVE" -> INACTIVE;
          default -> UUID.randomUUID();
        };
    call(user)
        .andExpect(status().isForbidden())
        .andExpect(header().string("Cache-Control", "no-store"));
    assertEquals(1, source.sql.size());
  }

  @Test
  void authenticationErrorsBeforeControllerHaveNoStoreAndSafeJson() throws Exception {
    mvc.perform(get(ENDPOINT).param("range", "TODAY"))
        .andExpect(status().isUnauthorized())
        .andExpect(header().string("Cache-Control", "no-store"))
        .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
    mvc.perform(get(ENDPOINT).header("Authorization", "Bearer invalid"))
        .andExpect(status().isUnauthorized())
        .andExpect(header().string("Cache-Control", "no-store"))
        .andExpect(content().string(not(containsString("PRIVATE"))));
    assertTrue(source.sql.isEmpty());
  }

  @ParameterizedTest
  @ValueSource(strings = {"cafeteriaId", "userId", "timezone", "asOf", "unknown"})
  void arbitrarySelectorsRejected(String parameter) throws Exception {
    mvc.perform(
            get(ENDPOINT)
                .param("range", "TODAY")
                .param(parameter, OTHER.toString())
                .with(jwt().jwt(t -> t.subject(ADMIN.toString()))))
        .andExpect(status().isBadRequest())
        .andExpect(header().string("Cache-Control", "no-store"));
    assertTrue(source.sql.isEmpty());
  }

  @Test
  void duplicateAndMalformedFiltersAndSubject() throws Exception {
    mvc.perform(
            get(ENDPOINT)
                .param("range", "TODAY", "TODAY")
                .with(jwt().jwt(t -> t.subject(ADMIN.toString()))))
        .andExpect(status().isBadRequest());
    mvc.perform(
            get(ENDPOINT)
                .param("range", "CUSTOM")
                .param("from", "2026-02-30")
                .param("to", "2026-03-01")
                .with(jwt().jwt(t -> t.subject(ADMIN.toString()))))
        .andExpect(status().isBadRequest());
    mvc.perform(get(ENDPOINT).param("range", "TODAY").with(jwt().jwt(t -> t.subject("invalid"))))
        .andExpect(status().isForbidden())
        .andExpect(header().string("Cache-Control", "no-store"));
  }

  @ParameterizedTest
  @ValueSource(strings = {"connection", "authorization", "query", "timeout"})
  void temporaryFailuresAre503AndRecover(String failure) throws Exception {
    source.failure = failure;
    call(ADMIN)
        .andExpect(status().isServiceUnavailable())
        .andExpect(header().string("Cache-Control", "no-store"))
        .andExpect(header().string("Retry-After", "5"))
        .andExpect(content().string(not(containsString("PRIVATE"))));
    source.reset();
    call(ADMIN).andExpect(status().isOk());
  }

  @Test
  void unexpectedFailureIsSafe500() throws Exception {
    source.failure = "unexpected";
    call(ADMIN)
        .andExpect(status().isInternalServerError())
        .andExpect(header().string("Cache-Control", "no-store"))
        .andExpect(jsonPath("$.code").value("ADMIN_DASHBOARD_INTERNAL_ERROR"))
        .andExpect(content().string(not(containsString("PRIVATE"))));
  }

  @Test
  void missingItemsSuppressOnlyDependentMetrics() throws Exception {
    order(CAFE, "NOT_COLLECTED", "2026-10-23T12:00:00Z", null, "2026-10-24T06:00:00Z", "15.25");
    call(ADMIN)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.summary.notCollectedOrders").value("1"))
        .andExpect(jsonPath("$.summary.notCollectedOrderValue").value("15.25"))
        .andExpect(jsonPath("$.summary.notCollectedUnits").value(nullValue()))
        .andExpect(jsonPath("$.summary.notCollectedItemValue").value(nullValue()))
        .andExpect(jsonPath("$.summary.notCollectedRatePercent").value("100.00"))
        .andExpect(
            jsonPath("$.notCollectedProducts.availability").value("UNAVAILABLE_INCOMPLETE_ITEMS"))
        .andExpect(jsonPath("$.notCollectedProducts.totals.units").value(nullValue()))
        .andExpect(jsonPath("$.topDeliveredProducts.availability").value("AVAILABLE"));
  }

  @Test
  void nullAndIncompatibleTerminalDatesAreNotReconstructed() throws Exception {
    order(CAFE, "DELIVERED", "2026-10-24T06:00:00Z", null, null, "10");
    order(CAFE, "NOT_COLLECTED", "2026-10-24T06:00:00Z", null, null, "10");
    order(CAFE, "DELIVERED", "2026-10-24T08:00:00Z", "2026-10-24T07:00:00Z", null, "10");
    order(
        CAFE,
        "DELIVERED",
        "2026-10-24T06:00:00Z",
        "2026-10-24T07:00:00Z",
        "2026-10-24T08:00:00Z",
        "10");
    order(CAFE, "PENDING", "2026-10-24T06:00:00Z", "2026-10-24T07:00:00Z", null, "10");
    order(CAFE, "DELIVERED", "2026-10-24T06:00:00Z", "infinity", null, "10");
    String body =
        call(ADMIN)
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.summary.receivedOrders").value("6"))
            .andExpect(jsonPath("$.summary.deliveredOrders").value("0"))
            .andExpect(jsonPath("$.summary.notCollectedOrders").value("0"))
            .andExpect(jsonPath("$.summary.notCollectedRatePercent").value(nullValue()))
            .andReturn()
            .getResponse()
            .getContentAsString();
    assertEquals(
        List.of("6"),
        JsonPath.read(
            body, "$.coverage.checks[?(@.scope.basis=='CREATED_COHORT')].affectedOrders"));
    assertEquals(
        List.of("3"),
        JsonPath.read(
            body,
            "$.coverage.checks[?(@.scope.basis=='RECORDED_TERMINAL_EVENTS')].affectedOrders"));
    assertEquals(
        List.of("NOT_CHECKED"),
        JsonPath.read(body, "$.coverage.checks[?(@.code=='UNDATED_TERMINALS')].status"));
  }

  @Test
  void emptyAndInactiveCafeteriasRemainReadable() throws Exception {
    call(SECOND)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.summary.receivedOrders").value("0"))
        .andExpect(jsonPath("$.summary.receivedOrderValue").value("0.00"))
        .andExpect(jsonPath("$.summary.notCollectedRatePercent").value(nullValue()))
        .andExpect(jsonPath("$.notCollectedProducts.items", hasSize(0)))
        .andExpect(jsonPath("$.notCollectedProducts.availability").value("AVAILABLE"))
        .andExpect(jsonPath("$.coverage.provenance.status").value("UNKNOWN"));
  }

  @Test
  void topTenDenominatorAndLargeUnitsAreComputedBeforeLimit() throws Exception {
    UUID order =
        order(CAFE, "NOT_COLLECTED", "2026-10-23T12:00:00Z", null, "2026-10-24T06:00:00Z", "0");
    for (int i = 1; i <= 12; i++) {
      UUID product = UUID.fromString(String.format("30000000-0000-0000-0000-%012d", i));
      product(product, CAFE);
      item(order, product, 1, "Snapshot " + i);
    }
    source.reset();
    call(ADMIN)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.notCollectedProducts.items", hasSize(10)))
        .andExpect(jsonPath("$.notCollectedProducts.hasMore").value(true))
        .andExpect(jsonPath("$.notCollectedProducts.totals.products").value("12"))
        .andExpect(jsonPath("$.notCollectedProducts.totals.orders").value("1"))
        .andExpect(jsonPath("$.notCollectedProducts.omitted.units").value("2"))
        .andExpect(jsonPath("$.notCollectedProducts.omitted.itemValue").value("20.00"))
        .andExpect(jsonPath("$.notCollectedProducts.items[0].unitSharePercent").value("8.33"))
        .andExpect(
            jsonPath("$.notCollectedProducts.items[0].productId")
                .value("30000000-0000-0000-0000-000000000001"));
    assertEquals(7, source.sql.size());
    // Multiple int-sized lines must accumulate beyond Integer.MAX_VALUE without overflow.
    jdbc.update("DELETE FROM public.order_items WHERE order_id=?", order);
    for (int i = 0; i < 5; i++) item(order, P1, 600_000_000, "Large");
    call(ADMIN)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.summary.notCollectedUnits").value("3000000000"))
        .andExpect(jsonPath("$.notCollectedProducts.totals.itemValue").value("30000000000.00"));
  }

  @Test
  void customBoundsAndTrendMatchSummaryAcrossBogotaYear() throws Exception {
    order(CAFE, "PENDING", "2025-12-31T05:00:00Z", null, null, "1.25");
    order(CAFE, "PENDING", "2026-01-02T04:59:59Z", null, null, "2.50");
    order(CAFE, "PENDING", "2026-01-02T05:00:00Z", null, null, "100");
    var result =
        mvc.perform(
                get(ENDPOINT)
                    .param("range", "CUSTOM")
                    .param("from", "2025-12-31")
                    .param("to", "2026-01-01")
                    .with(jwt().jwt(t -> t.subject(ADMIN.toString()))))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.period.partial").value(false))
            .andExpect(jsonPath("$.summary.receivedOrders").value("2"))
            .andExpect(jsonPath("$.summary.receivedOrderValue").value("3.75"))
            .andExpect(jsonPath("$.trend", hasSize(2)))
            .andExpect(jsonPath("$.trend[0].date").value("2025-12-31"))
            .andExpect(jsonPath("$.trend[1].date").value("2026-01-01"))
            .andReturn();
    List<String> counts =
        JsonPath.read(result.getResponse().getContentAsString(), "$.trend[*].receivedOrders");
    assertEquals(
        BigInteger.TWO,
        counts.stream().map(BigInteger::new).reduce(BigInteger.ZERO, BigInteger::add));
  }

  @Test
  void invalidHeaderAmountDoesNotHideOrderOrProduceFakeZero() throws Exception {
    UUID order =
        order(CAFE, "DELIVERED", "2026-10-23T12:00:00Z", "2026-10-24T06:00:00Z", null, "NaN");
    item(order, P1, 1, "Historical");
    call(ADMIN)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.summary.deliveredOrders").value("1"))
        .andExpect(jsonPath("$.summary.deliveredOrderValue").value(nullValue()))
        .andExpect(jsonPath("$.topDeliveredProducts.totals.itemValue").value("10.00"))
        .andExpect(
            jsonPath("$.coverage.warnings[?(@.code=='INVALID_HEADER_AMOUNT_DELIVERED')]")
                .isNotEmpty());
  }

  @ParameterizedTest
  @ValueSource(strings = {"ARITHMETIC", "QUANTITY", "CAFETERIA"})
  void legacyInvalidLinesCannotPublishAFalseRanking(String kind) throws Exception {
    UUID order =
        order(CAFE, "NOT_COLLECTED", "2026-10-23T12:00:00Z", null, "2026-10-24T06:00:00Z", "10");
    item(order, P1, 1, "Snapshot");
    // Deliberately represent legacy/corrupt schemas ONLY inside the owned disposable cluster.
    String constraint =
        switch (kind) {
          case "ARITHMETIC" -> "chk_item_subtotal";
          case "QUANTITY" -> "chk_order_item_quantity";
          default -> "fk_item_lunch_cafeteria";
        };
    String definition =
        jdbc.queryForObject(
            "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='public.order_items'::regclass AND conname=?",
            String.class,
            constraint);
    jdbc.execute("ALTER TABLE public.order_items DROP CONSTRAINT " + constraint);
    try {
      switch (kind) {
        case "ARITHMETIC" ->
            jdbc.update("UPDATE public.order_items SET subtotal=9 WHERE order_id=?", order);
        case "QUANTITY" ->
            jdbc.update(
                "UPDATE public.order_items SET quantity=0,subtotal=0 WHERE order_id=?", order);
        default -> {
          UUID foreign = UUID.randomUUID();
          product(foreign, OTHER);
          jdbc.update("UPDATE public.order_items SET lunch_id=? WHERE order_id=?", foreign, order);
        }
      }
      call(ADMIN)
          .andExpect(status().isOk())
          .andExpect(jsonPath("$.summary.notCollectedOrders").value("1"))
          .andExpect(jsonPath("$.summary.notCollectedOrderValue").value("10.00"))
          .andExpect(jsonPath("$.summary.notCollectedUnits").value(nullValue()))
          .andExpect(
              jsonPath("$.notCollectedProducts.availability")
                  .value("UNAVAILABLE_INCOMPLETE_ITEMS"));
    } finally {
      source.failure = "";
      jdbc.update("DELETE FROM public.order_items WHERE order_id=?", order);
      jdbc.execute(
          "ALTER TABLE public.order_items ADD CONSTRAINT " + constraint + " " + definition);
    }
  }

  @Test
  void missingLatestNameRemainsUnknownAndOrderUuidBreaksTies() throws Exception {
    UUID first =
        order(CAFE, "DELIVERED", "2026-10-23T12:00:00Z", "2026-10-24T06:00:00Z", null, "10");
    UUID second =
        order(CAFE, "DELIVERED", "2026-10-23T12:00:00Z", "2026-10-24T06:00:00Z", null, "10");
    item(first, P1, 1, "First");
    item(second, P1, 1, "Second");
    String expected = first.toString().compareTo(second.toString()) > 0 ? "First" : "Second";
    call(ADMIN)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.topDeliveredProducts.items[0].historicalName").value(expected));
    UUID latest =
        order(CAFE, "DELIVERED", "2026-10-23T12:00:00Z", "2026-10-24T07:00:00Z", null, "10");
    item(latest, P1, 1, "   ");
    call(ADMIN)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.topDeliveredProducts.availability").value("AVAILABLE"))
        .andExpect(jsonPath("$.topDeliveredProducts.items[0].historicalName").value(nullValue()))
        .andExpect(
            jsonPath("$.coverage.warnings[?(@.code=='MISSING_HISTORICAL_NAME_DELIVERED')]")
                .isNotEmpty());
  }
}

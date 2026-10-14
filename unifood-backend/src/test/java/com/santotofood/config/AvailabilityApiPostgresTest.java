package com.santotofood.config;

import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.hasSize;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.santotofood.adapter.in.web.AvailabilityController;
import com.santotofood.adapter.in.web.error.AvailabilityExceptionHandler;
import com.santotofood.adapter.in.web.error.GlobalExceptionHandler;
import com.santotofood.adapter.out.persistence.AuthorizationPersistenceAdapter;
import com.santotofood.adapter.out.persistence.DailyAvailabilityPersistenceAdapter;
import com.santotofood.adapter.out.persistence.entity.LunchEntity;
import com.santotofood.application.service.AvailabilityService;
import com.santotofood.domain.port.out.TimeProvider;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.*;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicReference;
import java.util.stream.Stream;
import javax.sql.DataSource;
import org.hibernate.SessionFactory;
import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.*;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.*;
import org.springframework.mock.web.MockServletContext;
import org.springframework.orm.jpa.JpaTransactionManager;
import org.springframework.orm.jpa.vendor.HibernateJpaDialect;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.BadJwtException;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.EnableTransactionManagement;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.context.support.AnnotationConfigWebApplicationContext;
import org.springframework.web.servlet.config.annotation.EnableWebMvc;

/** Native 001-013, HTTP authorization, JDBC transactions and observed PostgreSQL lock waits. */
@Timeout(60)
class AvailabilityApiPostgresTest {
  static final UUID CAFE = UUID.randomUUID(), OTHER = UUID.randomUUID();
  static final UUID WORKER = UUID.randomUUID(), WORKER_TWO = UUID.randomUUID();
  static final UUID ADMIN = UUID.randomUUID(),
      CLIENT = UUID.randomUUID(),
      SUPER = UUID.randomUUID();
  static final UUID INACTIVE = UUID.randomUUID(), UNASSIGNED = UUID.randomUUID();
  static final UUID ITEM = UUID.randomUUID(),
      Z_ITEM = UUID.randomUUID(),
      INACTIVE_ITEM = UUID.randomUUID();
  static final UUID FOREIGN = UUID.randomUUID(),
      ORDER = UUID.randomUUID(),
      SNAPSHOT = UUID.randomUUID();
  static final Instant NOW = Instant.parse("2026-10-13T12:00:00Z");
  static final LocalDate DAY = LocalDate.of(2026, 10, 13);
  static final AtomicReference<Instant> clock = new AtomicReference<>(NOW);
  static Process database;
  static AnnotationConfigWebApplicationContext context;
  static FailingDataSource source;
  static JdbcTemplate jdbc;
  static MockMvc mvc;
  static SessionFactory entityManagerFactory;
  static String historicalItem, legacyCatalog;
  static boolean preauditRolledBack;
  static boolean migrationPreservedCatalog;
  static List<String> oldConstraints;

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
    PlatformTransactionManager transactions(DataSource dataSource) {
      // The production Boot backend uses JPA. Its JDBC adapter must join the same
      // Hibernate connection so exceptions roll back the UPSERT instead of committing it.
      var manager = new JpaTransactionManager(entityManagerFactory);
      manager.setDataSource(dataSource);
      manager.setJpaDialect(new HibernateJpaDialect());
      return manager;
    }

    @Bean
    TimeProvider time() {
      return clock::get;
    }

    @Bean
    JwtDecoder jwtDecoder() {
      var decoder = mock(JwtDecoder.class);
      when(decoder.decode(anyString())).thenThrow(new BadJwtException("Private invalid token"));
      return decoder;
    }
  }

  static class FailingDataSource extends DelegatingDataSource {
    volatile boolean unavailable;
    int connectionsBeforeFailure = -1;

    FailingDataSource(DataSource target) {
      super(target);
    }

    @Override
    public Connection getConnection() throws SQLException {
      if (unavailable || connectionsBeforeFailure == 0)
        throw new SQLTransientConnectionException("PRIVATE_DB_DETAIL");
      if (connectionsBeforeFailure > 0) connectionsBeforeFailure--;
      return super.getConnection();
    }
  }

  @BeforeAll
  static void start() throws Exception {
    String bootstrap =
        """
        import { createNativeAuthDatabase, postgresBinaries }
          from '../unifood-web/tests/helpers/native-auth-database.mjs';
        const binaries = await postgresBinaries();
        if (!binaries) throw new Error('Native PostgreSQL required for availability');
        const db = await createNativeAuthDatabase(binaries, { throughMigration: '012' });
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
    assertNotNull(metadata, "Native PostgreSQL failed to start");
    String url = metadata.substring(metadata.indexOf("jdbc:"), metadata.lastIndexOf('"'));
    assertTrue(url.startsWith("jdbc:postgresql://127.0.0.1:"));
    source = new FailingDataSource(new DriverManagerDataSource(url, "postgres", ""));
    jdbc = new JdbcTemplate(source);
    seed();
    historicalItem = snapshot("order_items", SNAPSHOT);
    legacyCatalog = snapshot("lunches", ITEM);
    oldConstraints = catalogConstraints();
    // 013 must abort and leave data and schema untouched, including inactive items.
    jdbc.update("UPDATE public.lunches SET category=NULL WHERE id=?", INACTIVE_ITEM);
    SQLException rejected = assertThrows(SQLException.class, AvailabilityApiPostgresTest::migrate);
    assertEquals("23514", rejected.getSQLState());
    preauditRolledBack =
        jdbc.queryForObject(
                "SELECT to_regclass('public.daily_item_availability') IS NULL AND to_regclass('public.cafeteria_daily_states') IS NULL",
                Boolean.class)
            && !jdbc.queryForObject(
                "SELECT attnotnull FROM pg_attribute WHERE attrelid='public.lunches'::regclass AND attname='category'",
                Boolean.class);
    assertTrue(preauditRolledBack);
    assertNull(
        jdbc.queryForObject(
            "SELECT category::text FROM public.lunches WHERE id=?", String.class, INACTIVE_ITEM));
    jdbc.update("UPDATE public.lunches SET category='ESPECIAL' WHERE id=?", INACTIVE_ITEM);
    migrate();
    migrationPreservedCatalog = legacyCatalog.equals(snapshot("lunches", ITEM));
    var hibernate =
        new org.hibernate.cfg.Configuration()
            .addAnnotatedClass(LunchEntity.class)
            .setProperty("hibernate.hbm2ddl.auto", "validate")
            .setProperty("hibernate.show_sql", "false");
    hibernate.getProperties().put("hibernate.connection.datasource", source);
    entityManagerFactory = hibernate.buildSessionFactory();
    context = new AnnotationConfigWebApplicationContext();
    context.setServletContext(new MockServletContext());
    context.register(
        TestConfig.class,
        SecurityConfig.class,
        OrderAuthorization.class,
        AuthorizationPersistenceAdapter.class,
        DailyAvailabilityPersistenceAdapter.class,
        AvailabilityService.class,
        AvailabilityController.class,
        AvailabilityExceptionHandler.class,
        GlobalExceptionHandler.class);
    context.refresh();
    mvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
  }

  static void seed() {
    UUID site = UUID.randomUUID();
    jdbc.update(
        "INSERT INTO public.sites(id,name,city,institution_id) SELECT ?,'Availability','test',id FROM public.institutions LIMIT 1",
        site);
    for (UUID cafe : List.of(CAFE, OTHER))
      jdbc.update(
          "INSERT INTO public.cafeterias(id,site_id,name,is_active,lunch_order_start,lunch_order_end) VALUES (?,?,?,false,'07:00','08:00')",
          cafe,
          site,
          cafe.equals(CAFE) ? "Own cafeteria" : "Foreign cafeteria");
    provision(ADMIN, "ADMIN", CAFE, true);
    provision(WORKER, "WORKER", CAFE, true);
    provision(WORKER_TWO, "WORKER", CAFE, true);
    provision(INACTIVE, "WORKER", CAFE, false);
    provision(UNASSIGNED, "WORKER", null, false);
    provision(CLIENT, "CLIENT", null, true);
    provision(SUPER, "SUPER_ADMIN", null, true);
    jdbc.update("UPDATE public.cafeterias SET is_active=true WHERE id=?", CAFE);
    lunch(ITEM, CAFE, "A lunch", "CORRIENTE", true);
    lunch(Z_ITEM, CAFE, "Z lunch", "CORRIENTE", true);
    lunch(INACTIVE_ITEM, CAFE, "Hidden", "ESPECIAL", false);
    lunch(FOREIGN, OTHER, "Foreign", "DEL_DIA", true);
    for (String category : List.of("DEL_DIA", "EJECUTIVO", "ESPECIAL", "DESAYUNO"))
      lunch(UUID.randomUUID(), CAFE, category, category, true);
    jdbc.update(
        "INSERT INTO public.orders(id,cafeteria_id,client_name,total) VALUES (?,?,'History',14000)",
        ORDER,
        CAFE);
    jdbc.update(
        "INSERT INTO public.order_items(id,order_id,lunch_id,lunch_name,unit_price,quantity,subtotal) VALUES (?,?,?,'Historical snapshot',7000,2,14000)",
        SNAPSHOT,
        ORDER,
        ITEM);
  }

  static void provision(UUID user, String role, UUID cafe, boolean active) {
    jdbc.update(
        "INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES (?,?,'{}')",
        user,
        user + "@example.invalid");
    jdbc.update(
        "INSERT INTO public.user_roles(user_id,role_id) SELECT ?,id FROM public.roles WHERE name::text=?",
        user,
        role);
    if (cafe != null)
      jdbc.update(
          "INSERT INTO public.cafeteria_users(user_id,cafeteria_id) VALUES (?,?)", user, cafe);
    if (active) jdbc.update("UPDATE public.users SET is_active=true WHERE id=?", user);
  }

  static void lunch(UUID item, UUID cafe, String name, String category, boolean active) {
    jdbc.update(
        "INSERT INTO public.lunches(id,cafeteria_id,name,description,price,image_url,stock,is_active,category) VALUES (?,?,?,'Description',15000,'image',0,?,?::public.catalog_category)",
        item,
        cafe,
        name,
        active,
        category);
  }

  static void migrate() throws Exception {
    try (var connection = source.getConnection();
        var statement = connection.createStatement()) {
      statement.execute(
          Files.readString(
              Path.of("supabase/migrations/013_daily_availability.sql"), StandardCharsets.UTF_8));
    }
  }

  static String snapshot(String table, UUID id) {
    // Table names are fixed test constants, UUID is always bound.
    return jdbc.queryForObject(
        "SELECT to_jsonb(t)::text FROM public." + table + " t WHERE id=?", String.class, id);
  }

  static List<String> catalogConstraints() {
    return jdbc.queryForList(
        "SELECT conname||':'||pg_get_constraintdef(oid) FROM pg_constraint WHERE contype<>'n' AND conrelid IN ('public.lunches'::regclass,'public.orders'::regclass,'public.order_items'::regclass) ORDER BY conname",
        String.class);
  }

  @BeforeEach
  void resetDay() {
    clock.set(NOW);
    source.unavailable = false;
    source.connectionsBeforeFailure = -1;
    jdbc.update("DELETE FROM public.daily_item_availability");
    jdbc.update("DELETE FROM public.cafeteria_daily_states");
    jdbc.update("UPDATE public.cafeterias SET is_active=true WHERE id=? AND NOT is_active", CAFE);
    jdbc.update("UPDATE public.lunches SET is_active=true WHERE id=? AND NOT is_active", ITEM);
  }

  @AfterAll
  static void stop() throws Exception {
    if (context != null) context.close();
    if (entityManagerFactory != null) entityManagerFactory.close();
    if (database != null && database.isAlive()) {
      database.getOutputStream().write("stop\n".getBytes(StandardCharsets.UTF_8));
      database.getOutputStream().flush();
      assertTrue(database.waitFor(30, TimeUnit.SECONDS));
      assertEquals(0, database.exitValue());
    }
  }

  static RequestPostProcessor worker(UUID subject) {
    // Security test fixture stands for an already verified JWT; business claims are untrusted.
    return jwt()
        .jwt(
            token ->
                token
                    .subject(subject.toString())
                    .claim("role", "SUPER_ADMIN")
                    .claim("cafeteriaId", OTHER.toString())
                    .claim("userId", SUPER.toString()));
  }

  static String route(boolean item) {
    return "/api/worker/availability/today/" + (item ? "items/" + ITEM : "cafeteria-state");
  }

  static String body(boolean item, boolean value) {
    return "{\"" + (item ? "available" : "open") + "\":" + value + "}";
  }

  @Test
  void migrationRejectsUnclassifiedDataAtomicallyAndPreservesHistoryAfterExplicitClassification() {
    assertTrue(preauditRolledBack);
    assertEquals(historicalItem, snapshot("order_items", SNAPSHOT));
    assertTrue(migrationPreservedCatalog);
    assertEquals(oldConstraints, catalogConstraints());
    assertTrue(
        jdbc.queryForObject(
            "SELECT attnotnull FROM pg_attribute WHERE attrelid='public.lunches'::regclass AND attname='category'",
            Boolean.class));
    assertNull(
        jdbc.queryForObject(
            "SELECT column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='lunches' AND column_name='category'",
            String.class));
  }

  @Test
  void readsDefaultFalseWithFixedCategoriesStableItemsAndNoSideEffectsOrStockDependency()
      throws Exception {
    mvc.perform(
            get("/api/worker/availability/today")
                .with(worker(WORKER))
                .queryParam("cafeteriaId", OTHER.toString()))
        .andExpect(status().isOk())
        .andExpect(header().string("Cache-Control", "no-store"))
        .andExpect(jsonPath("$.businessDate").value(DAY.toString()))
        .andExpect(jsonPath("$.cafeteria.id").value(CAFE.toString()))
        .andExpect(jsonPath("$.cafeteria.open").value(false))
        .andExpect(jsonPath("$.categories", hasSize(5)))
        .andExpect(
            jsonPath("$.categories[*].category")
                .value(contains("DEL_DIA", "CORRIENTE", "EJECUTIVO", "ESPECIAL", "DESAYUNO")))
        .andExpect(jsonPath("$.categories[1].items[*].name").value(contains("A lunch", "Z lunch")))
        .andExpect(jsonPath("$.categories[1].items[0].available").value(false))
        .andExpect(jsonPath("$.categories[1].items[0].*", hasSize(6)))
        .andExpect(jsonPath("$.categories[*].items[*].id", hasSize(6)));
    assertEquals(0, count("cafeteria_daily_states"));
    assertEquals(0, count("daily_item_availability"));
  }

  @Test
  void allRolesAndInactiveUnassignedInvalidSubjectsAreDeniedForReadsAndWrites() throws Exception {
    for (UUID subject : List.of(CLIENT, ADMIN, SUPER, INACTIVE, UNASSIGNED, UUID.randomUUID())) {
      mvc.perform(get("/api/worker/availability/today").with(worker(subject)))
          .andExpect(status().isForbidden())
          .andExpect(jsonPath("$.code").value("AVAILABILITY_FORBIDDEN"));
      mvc.perform(
              put(route(false))
                  .with(worker(subject))
                  .header("X-Business-Date", DAY)
                  .contentType("application/json")
                  .content(body(false, true)))
          .andExpect(status().isForbidden());
      mvc.perform(
              put(route(true))
                  .with(worker(subject))
                  .header("X-Business-Date", DAY)
                  .contentType("application/json")
                  .content(body(true, true)))
          .andExpect(status().isForbidden());
    }
    mvc.perform(
            get("/api/worker/availability/today")
                .with(jwt().jwt(token -> token.subject("invalid"))))
        .andExpect(status().isForbidden());
    assertEquals(0, count("daily_item_availability"));
  }

  @Test
  void absentOrForgedAuthenticationIs401ForAllEndpoints() throws Exception {
    mvc.perform(get("/api/worker/availability/today")).andExpect(status().isUnauthorized());
    for (boolean item : List.of(false, true)) {
      mvc.perform(
              put(route(item))
                  .header("X-Business-Date", DAY)
                  .contentType("application/json")
                  .content(body(item, true)))
          .andExpect(status().isUnauthorized());
      mvc.perform(
              put(route(item))
                  .header("Authorization", "Bearer forged-token")
                  .header("X-Business-Date", DAY)
                  .contentType("application/json")
                  .content(body(item, true)))
          .andExpect(status().isUnauthorized());
    }
  }

  @ParameterizedTest
  @ValueSource(booleans = {false, true})
  void absoluteWritesAreIdempotentAndResetByBusinessDateWithoutDeletingHistory(boolean item)
      throws Exception {
    for (boolean value : List.of(true, true, false, false, true))
      mvc.perform(
              put(route(item))
                  .with(worker(WORKER))
                  .header("X-Business-Date", DAY)
                  .contentType("application/json")
                  .content(body(item, value)))
          .andExpect(status().isOk())
          .andExpect(header().string("Cache-Control", "no-store"))
          .andExpect(jsonPath("$.businessDate").value(DAY.toString()))
          .andExpect(jsonPath(item ? "$.available" : "$.open").value(value));
    assertEquals(1, count(item ? "daily_item_availability" : "cafeteria_daily_states"));
    clock.set(Instant.parse("2026-10-14T05:00:00Z"));
    mvc.perform(get("/api/worker/availability/today").with(worker(WORKER)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.businessDate").value("2026-10-14"))
        .andExpect(jsonPath("$.cafeteria.open").value(false))
        .andExpect(jsonPath("$.categories[1].items[0].available").value(false));
    mvc.perform(
            put(route(item))
                .with(worker(WORKER))
                .header("X-Business-Date", DAY)
                .contentType("application/json")
                .content(body(item, false)))
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.code").value("AVAILABILITY_DAY_EXPIRED"));
    assertEquals(1, count(item ? "daily_item_availability" : "cafeteria_daily_states"));
  }

  @Test
  void inactiveCafeteriaCanBeReadClosedAndDisabledButCannotBeOpenedOrEnabled() throws Exception {
    for (boolean item : List.of(false, true))
      mvc.perform(
              put(route(item))
                  .with(worker(WORKER))
                  .header("X-Business-Date", DAY)
                  .contentType("application/json")
                  .content(body(item, true)))
          .andExpect(status().isOk());
    jdbc.update("UPDATE public.cafeterias SET is_active=false WHERE id=?", CAFE);
    mvc.perform(get("/api/worker/availability/today").with(worker(WORKER)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.cafeteria.active").value(false))
        .andExpect(jsonPath("$.cafeteria.open").value(true))
        .andExpect(jsonPath("$.categories[1].items[0].available").value(true));
    for (boolean item : List.of(false, true)) {
      mvc.perform(
              put(route(item))
                  .with(worker(WORKER))
                  .header("X-Business-Date", DAY)
                  .contentType("application/json")
                  .content(body(item, true)))
          .andExpect(status().isConflict())
          .andExpect(header().string("Cache-Control", "no-store"))
          .andExpect(jsonPath("$.code").value("AVAILABILITY_CAFETERIA_INACTIVE"));
      mvc.perform(
              put(route(item))
                  .with(worker(WORKER))
                  .header("X-Business-Date", DAY)
                  .contentType("application/json")
                  .content(body(item, false)))
          .andExpect(status().isOk());
    }
  }

  @Test
  void inactiveItemCanOnlyBeDisabledAndForeignOrMissingItemsHaveTheSame404() throws Exception {
    String base = "/api/worker/availability/today/items/";
    mvc.perform(
            put(base + INACTIVE_ITEM)
                .with(worker(WORKER))
                .header("X-Business-Date", DAY)
                .contentType("application/json")
                .content("{\"available\":true}"))
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.code").value("AVAILABILITY_ITEM_INACTIVE"));
    mvc.perform(
            put(base + INACTIVE_ITEM)
                .with(worker(WORKER))
                .header("X-Business-Date", DAY)
                .contentType("application/json")
                .content("{\"available\":false}"))
        .andExpect(status().isOk());
    for (UUID item : List.of(FOREIGN, UUID.randomUUID()))
      mvc.perform(
              put(base + item)
                  .with(worker(WORKER))
                  .header("X-Business-Date", DAY)
                  .contentType("application/json")
                  .content("{\"available\":true}"))
          .andExpect(status().isNotFound())
          .andExpect(header().string("Cache-Control", "no-store"))
          .andExpect(jsonPath("$.code").value("AVAILABILITY_ITEM_NOT_FOUND"))
          .andExpect(
              jsonPath("$.message").value("El producto no está disponible para esta operación."));
  }

  @Test
  void malformedBodiesHeadersAndUuidsFailSafelyWithoutWrites() throws Exception {
    for (String content : List.of("{}", "{\"open\":null}", "{", "[]"))
      mvc.perform(
              put(route(false))
                  .with(worker(WORKER))
                  .header("X-Business-Date", DAY)
                  .contentType("application/json")
                  .content(content))
          .andExpect(status().isBadRequest())
          .andExpect(jsonPath("$.code").value("AVAILABILITY_INVALID_REQUEST"));
    mvc.perform(
            put(route(false))
                .with(worker(WORKER))
                .contentType("application/json")
                .content(body(false, true)))
        .andExpect(status().isBadRequest());
    for (String date : List.of("bad-date", "2026-02-31"))
      mvc.perform(
              put(route(false))
                  .with(worker(WORKER))
                  .header("X-Business-Date", date)
                  .contentType("application/json")
                  .content(body(false, true)))
          .andExpect(status().isBadRequest());
    mvc.perform(
            put("/api/worker/availability/today/items/not-uuid")
                .with(worker(WORKER))
                .header("X-Business-Date", DAY)
                .contentType("application/json")
                .content(body(true, true)))
        .andExpect(status().isBadRequest());
    assertEquals(0, count("cafeteria_daily_states"));
  }

  @Test
  void temporaryDatabaseFailureIsSafe503AndSameIdentityCanRecover() throws Exception {
    try {
      source.unavailable = true;
      var result =
          mvc.perform(get("/api/worker/availability/today").with(worker(WORKER)))
              .andExpect(status().isServiceUnavailable())
              .andExpect(header().string("Retry-After", "5"))
              .andExpect(header().string("Cache-Control", "no-store"))
              .andExpect(jsonPath("$.code").value("AVAILABILITY_TEMPORARILY_UNAVAILABLE"))
              .andReturn();
      assertFalse(result.getResponse().getContentAsString().contains("PRIVATE"));
    } finally {
      source.unavailable = false;
    }
    mvc.perform(get("/api/worker/availability/today").with(worker(WORKER)))
        .andExpect(status().isOk());
  }

  @Test
  void transactionStartFailureAfterSuccessfulAuthorizationIsAlsoSafe503AndCanRecover()
      throws Exception {
    try {
      source.connectionsBeforeFailure = 1;
      mvc.perform(
              put(route(false))
                  .with(worker(WORKER))
                  .header("X-Business-Date", DAY)
                  .contentType("application/json")
                  .content(body(false, true)))
          .andExpect(status().isServiceUnavailable())
          .andExpect(header().string("Retry-After", "5"))
          .andExpect(jsonPath("$.code").value("AVAILABILITY_TEMPORARILY_UNAVAILABLE"));
    } finally {
      source.connectionsBeforeFailure = -1;
    }
    assertEquals(0, count("cafeteria_daily_states"));
    mvc.perform(
            put(route(false))
                .with(worker(WORKER))
                .header("X-Business-Date", DAY)
                .contentType("application/json")
                .content(body(false, true)))
        .andExpect(status().isOk());
  }

  @Test
  void emptyActiveCatalogStillReturnsAllFiveEmptyGroups() throws Exception {
    var activeItems =
        jdbc.queryForList(
            "SELECT id FROM public.lunches WHERE cafeteria_id=? AND is_active", UUID.class, CAFE);
    try {
      jdbc.update("UPDATE public.lunches SET is_active=false WHERE cafeteria_id=?", CAFE);
      mvc.perform(get("/api/worker/availability/today").with(worker(WORKER)))
          .andExpect(status().isOk())
          .andExpect(jsonPath("$.categories", hasSize(5)))
          .andExpect(jsonPath("$.categories[*].items[*]", hasSize(0)));
    } finally {
      for (UUID item : activeItems)
        jdbc.update("UPDATE public.lunches SET is_active=true WHERE id=?", item);
    }
  }

  @Test
  void constraintsRejectDuplicatesCrossCafeteriaMissingParentsAndNullsWhileAllowingHistory() {
    jdbc.update(
        "INSERT INTO public.cafeteria_daily_states(cafeteria_id,business_date,is_open) VALUES (?,'2000-01-01',true)",
        CAFE);
    sqlFailure(
        "23505",
        "INSERT INTO public.cafeteria_daily_states(cafeteria_id,business_date,is_open) VALUES (?,'2000-01-01',false)",
        CAFE);
    jdbc.update(
        "INSERT INTO public.daily_item_availability(cafeteria_id,item_id,business_date,is_available) VALUES (?,?,'2000-01-01',true)",
        CAFE,
        ITEM);
    sqlFailure(
        "23505",
        "INSERT INTO public.daily_item_availability(cafeteria_id,item_id,business_date,is_available) VALUES (?,?,'2000-01-01',false)",
        CAFE,
        ITEM);
    sqlFailure(
        "23503",
        "INSERT INTO public.daily_item_availability(cafeteria_id,item_id,business_date,is_available) VALUES (?,?,'2001-01-01',false)",
        OTHER,
        ITEM);
    sqlFailure(
        "23503",
        "INSERT INTO public.daily_item_availability(cafeteria_id,item_id,business_date,is_available) VALUES (?,?,'2001-01-01',false)",
        CAFE,
        UUID.randomUUID());
    sqlFailure(
        "23503",
        "INSERT INTO public.cafeteria_daily_states(cafeteria_id,business_date,is_open) VALUES (?,'2000-01-01',false)",
        UUID.randomUUID());
    sqlFailure("23503", "UPDATE public.lunches SET cafeteria_id=? WHERE id=?", OTHER, ITEM);
    for (String table : List.of("cafeteria_daily_states", "daily_item_availability")) {
      for (String column :
          List.of(
              "business_date",
              "created_at",
              "updated_at",
              table.equals("cafeteria_daily_states") ? "is_open" : "is_available"))
        sqlFailure("23502", "UPDATE public." + table + " SET " + column + "=NULL");
    }
    assertEquals(historicalItem, snapshot("order_items", SNAPSHOT));
  }

  @Test
  void tableColumnPublicAndInheritedPrivilegesAreClosedAndReadOnlyAuditDetectsUnexpectedGrants()
      throws Exception {
    List<String> tables = List.of("cafeteria_daily_states", "daily_item_availability");
    for (String table : tables) {
      for (String role : List.of("anon", "authenticated")) {
        for (String privilege :
            List.of("SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"))
          assertFalse(
              jdbc.queryForObject(
                  "SELECT has_table_privilege(?,?::regclass,?)",
                  Boolean.class,
                  role,
                  "public." + table,
                  privilege));
        for (String privilege : List.of("SELECT", "INSERT", "UPDATE", "REFERENCES"))
          assertFalse(
              jdbc.queryForObject(
                  "SELECT has_any_column_privilege(?,?::regclass,?)",
                  Boolean.class,
                  role,
                  "public." + table,
                  privilege));
      }
      assertTrue(
          jdbc.queryForObject(
              "SELECT relrowsecurity FROM pg_class WHERE oid=?::regclass",
              Boolean.class,
              "public." + table));
      assertEquals(
          0,
          jdbc.queryForObject(
              "SELECT count(*) FROM pg_class c CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) p WHERE c.oid=?::regclass AND p.grantee=0",
              Integer.class,
              "public." + table));
    }
    assertEquals(0, audit().size());
    // Inherited PUBLIC table access and an explicit column grant must both be reported.
    jdbc.execute(
        "GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON public.cafeteria_daily_states TO PUBLIC");
    jdbc.execute("GRANT UPDATE(is_available) ON public.daily_item_availability TO authenticated");
    try {
      var findings = audit();
      for (String privilege : List.of("SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE"))
        assertTrue(findings.contains("table:anon:cafeteria_daily_states:" + privilege));
      assertTrue(findings.contains("column:authenticated:daily_item_availability:UPDATE"));
    } finally {
      jdbc.execute("REVOKE ALL ON public.cafeteria_daily_states FROM PUBLIC");
      jdbc.execute("REVOKE ALL(is_available) ON public.daily_item_availability FROM authenticated");
    }
    assertTrue(audit().isEmpty());
  }

  static Set<String> audit() throws Exception {
    Set<String> findings = new HashSet<>();
    String script =
        Files.readString(Path.of("supabase/audit_business_integrity.sql"), StandardCharsets.UTF_8);
    assertTrue(script.contains("REPEATABLE READ READ ONLY"));
    try (var connection = source.getConnection();
        var statement = connection.createStatement()) {
      boolean rows = statement.execute(script);
      while (true) {
        if (rows) {
          try (var result = statement.getResultSet()) {
            Set<String> columns = new HashSet<>();
            for (int i = 1; i <= result.getMetaData().getColumnCount(); i++)
              columns.add(result.getMetaData().getColumnLabel(i));
            while (result.next()) {
              for (String kind : List.of("table", "column")) {
                String field = "unexpected_business_" + kind + "_grant";
                if (columns.contains(field))
                  findings.add(
                      kind
                          + ":"
                          + result.getString("actor")
                          + ":"
                          + result.getString(field)
                          + ":"
                          + result.getString("privilege"));
              }
              for (String flag :
                  List.of(
                      "unexpected_rpc_permission",
                      "unexpected_helper_execute",
                      "unexpected_type_usage"))
                if (columns.contains(flag) && result.getBoolean(flag)) findings.add(flag);
            }
          }
        } else if (statement.getUpdateCount() == -1) break;
        rows = statement.getMoreResults();
      }
    }
    return findings;
  }

  static Stream<Arguments> races() {
    return Stream.of(false, true)
        .flatMap(
            item ->
                Stream.of(
                    Arguments.of(item, true, true),
                    Arguments.of(item, false, false),
                    Arguments.of(item, true, false),
                    Arguments.of(item, false, true)));
  }

  @ParameterizedTest
  @MethodSource("races")
  void twoAuthorizedWorkersSerializeSameKeyAndLastConfirmedAbsoluteValueWins(
      boolean item, boolean firstValue, boolean secondValue) throws Exception {
    try (var executor = Executors.newFixedThreadPool(2)) {
      var firstWritten = new CountDownLatch(1);
      var release = new CountDownLatch(1);
      Future<?> first =
          executor.submit(
              () ->
                  transaction()
                      .execute(
                          status -> {
                            var auth =
                                new JwtAuthenticationToken(
                                    Jwt.withTokenValue("verified-test")
                                        .header("alg", "test")
                                        .subject(WORKER.toString())
                                        .build(),
                                    List.of());
                            SecurityContextHolder.getContext().setAuthentication(auth);
                            try {
                              var controller = context.getBean(AvailabilityController.class);
                              if (item)
                                controller.item(
                                    auth,
                                    ITEM,
                                    DAY,
                                    new AvailabilityController.ItemRequest(firstValue));
                              else
                                controller.cafeteriaState(
                                    auth,
                                    DAY,
                                    new AvailabilityController.CafeteriaRequest(firstValue));
                              firstWritten.countDown();
                              await(release);
                              return null;
                            } finally {
                              SecurityContextHolder.clearContext();
                            }
                          }));
      assertTrue(firstWritten.await(5, TimeUnit.SECONDS));
      Future<?> second =
          executor.submit(
              () -> {
                try {
                  return mvc.perform(
                          put(route(item))
                              .with(worker(WORKER_TWO))
                              .header("X-Business-Date", DAY)
                              .contentType("application/json")
                              .content(body(item, secondValue)))
                      .andExpect(status().isOk())
                      .andReturn();
                } catch (Exception exception) {
                  throw new RuntimeException(exception);
                }
              });
      try {
        observedWait(item ? "daily_item_availability" : "cafeteria_daily_states");
      } finally {
        release.countDown();
      }
      first.get(10, TimeUnit.SECONDS);
      second.get(10, TimeUnit.SECONDS);
    }
    String table = item ? "daily_item_availability" : "cafeteria_daily_states";
    assertEquals(1, count(table));
    assertEquals(
        secondValue,
        jdbc.queryForObject(
            "SELECT " + (item ? "is_available" : "is_open") + " FROM public." + table,
            Boolean.class));
  }

  @ParameterizedTest
  @ValueSource(booleans = {false, true})
  void midnightWhileWaitingForUpsertRejectsAndRollsBackTheStaleWrite(boolean item)
      throws Exception {
    String table = item ? "daily_item_availability" : "cafeteria_daily_states";
    try (var blocker = source.getConnection();
        var executor = Executors.newSingleThreadExecutor()) {
      blocker.setAutoCommit(false);
      var blockerJdbc = new JdbcTemplate(new SingleConnectionDataSource(blocker, true));
      if (item)
        blockerJdbc.update(
            "INSERT INTO public.daily_item_availability(cafeteria_id,item_id,business_date,is_available) VALUES (?,?,?,true)",
            CAFE,
            ITEM,
            DAY);
      else
        blockerJdbc.update(
            "INSERT INTO public.cafeteria_daily_states(cafeteria_id,business_date,is_open) VALUES (?,?,true)",
            CAFE,
            DAY);
      Future<?> pending =
          executor.submit(
              () -> {
                try {
                  return mvc.perform(
                          put(route(item))
                              .with(worker(WORKER_TWO))
                              .header("X-Business-Date", DAY)
                              .contentType("application/json")
                              .content(body(item, false)))
                      .andExpect(status().isConflict())
                      .andExpect(jsonPath("$.code").value("AVAILABILITY_DAY_EXPIRED"))
                      .andReturn();
                } catch (Exception exception) {
                  throw new RuntimeException(exception);
                }
              });
      try {
        observedWait(table);
        clock.set(Instant.parse("2026-10-14T05:00:00Z"));
      } finally {
        blocker.commit();
      }
      pending.get(10, TimeUnit.SECONDS);
    }
    assertEquals(1, count(table));
    assertTrue(
        jdbc.queryForObject(
            "SELECT " + (item ? "is_available" : "is_open") + " FROM public." + table,
            Boolean.class));
    assertEquals(
        DAY, jdbc.queryForObject("SELECT business_date FROM public." + table, LocalDate.class));
  }

  @ParameterizedTest
  @ValueSource(booleans = {false, true})
  void enablingObservesAdministrativeDeactivationThatCommitsDuringItsLockWait(boolean item)
      throws Exception {
    String table = item ? "lunches" : "cafeterias";
    UUID id = item ? ITEM : CAFE;
    try (var blocker = source.getConnection();
        var executor = Executors.newSingleThreadExecutor()) {
      blocker.setAutoCommit(false);
      new JdbcTemplate(new SingleConnectionDataSource(blocker, true))
          .update("UPDATE public." + table + " SET is_active=false WHERE id=?", id);
      Future<?> pending =
          executor.submit(
              () -> {
                try {
                  return mvc.perform(
                          put(route(item))
                              .with(worker(WORKER_TWO))
                              .header("X-Business-Date", DAY)
                              .contentType("application/json")
                              .content(body(item, true)))
                      .andExpect(status().isConflict())
                      .andExpect(
                          jsonPath("$.code")
                              .value(
                                  item
                                      ? "AVAILABILITY_ITEM_INACTIVE"
                                      : "AVAILABILITY_CAFETERIA_INACTIVE"))
                      .andReturn();
                } catch (Exception exception) {
                  throw new RuntimeException(exception);
                }
              });
      try {
        observedWait(table);
      } finally {
        blocker.commit();
      }
      pending.get(10, TimeUnit.SECONDS);
    }
    assertEquals(0, count(item ? "daily_item_availability" : "cafeteria_daily_states"));
  }

  static TransactionTemplate transaction() {
    return new TransactionTemplate(context.getBean(PlatformTransactionManager.class));
  }

  static int count(String table) {
    return jdbc.queryForObject("SELECT count(*) FROM public." + table, Integer.class);
  }

  static void await(CountDownLatch latch) {
    try {
      if (!latch.await(10, TimeUnit.SECONDS))
        throw new AssertionError("Timed out coordinating commit");
    } catch (InterruptedException exception) {
      Thread.currentThread().interrupt();
      throw new AssertionError(exception);
    }
  }

  static void observedWait(String table) throws Exception {
    long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
    while (System.nanoTime() < deadline) {
      if (jdbc.queryForObject(
              "SELECT count(*) FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE ?",
              Integer.class,
              "%" + table + "%")
          > 0) return;
      Thread.sleep(20);
    }
    fail("No observed PostgreSQL lock wait for " + table);
  }

  static void sqlFailure(String state, String sql, Object... args) {
    var failure = assertThrows(DataAccessException.class, () -> jdbc.update(sql, args));
    assertInstanceOf(SQLException.class, failure.getMostSpecificCause());
    assertEquals(state, ((SQLException) failure.getMostSpecificCause()).getSQLState());
  }
}

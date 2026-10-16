package com.santotofood.config;

import static org.hamcrest.Matchers.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.santotofood.adapter.in.web.WorkerProfileController;
import com.santotofood.adapter.in.web.error.GlobalExceptionHandler;
import com.santotofood.adapter.in.web.error.WorkerProfileExceptionHandler;
import com.santotofood.adapter.out.persistence.AuthorizationPersistenceAdapter;
import com.santotofood.adapter.out.persistence.WorkerProfilePersistenceAdapter;
import com.santotofood.application.service.WorkerProfileService;
import jakarta.persistence.EntityManagerFactory;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Proxy;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.SQLException;
import java.sql.SQLTransientConnectionException;
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

/** Real 001-014 PostgreSQL, actual security/policy/JDBC and no external database. */
@Timeout(60)
class WorkerProfileApiPostgresTest {
  static final String ENDPOINT = "/api/worker/profile";
  static final UUID INSTITUTION = UUID.randomUUID(), OTHER_INSTITUTION = UUID.randomUUID();
  static final UUID SITE = UUID.randomUUID(), OTHER_SITE = UUID.randomUUID();
  static final UUID CAFE = UUID.randomUUID(), OTHER_CAFE = UUID.randomUUID();
  static final UUID WORKER = UUID.randomUUID(), SECOND = UUID.randomUUID();
  static final UUID INACTIVE = UUID.randomUUID(), UNASSIGNED = UUID.randomUUID();
  static final UUID ADMIN = UUID.randomUUID(),
      CLIENT = UUID.randomUUID(),
      SUPER = UUID.randomUUID();
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
    LocalContainerEntityManagerFactoryBean entityManagerFactory(DataSource dataSource) {
      var factory = new LocalContainerEntityManagerFactoryBean();
      factory.setDataSource(dataSource);
      factory.setJpaVendorAdapter(new HibernateJpaVendorAdapter());
      // No entities are required by this projection. Keep production's Spring/Hibernate
      // transaction integration, including connection preparation for REPEATABLE READ.
      factory.setManagedTypes(PersistenceManagedTypes.of());
      factory.setJpaPropertyMap(Map.of("hibernate.hbm2ddl.auto", "none"));
      return factory;
    }

    @Bean
    JpaTransactionManager transactionManager(EntityManagerFactory entityManagerFactory) {
      return new JpaTransactionManager(entityManagerFactory);
    }

    @Bean
    JwtDecoder jwtDecoder() {
      var decoder = mock(JwtDecoder.class);
      when(decoder.decode(anyString())).thenThrow(new BadJwtException("Invalid fixture token"));
      return decoder;
    }
  }

  static class TrackingDataSource extends DelegatingDataSource {
    volatile boolean unavailable, unexpectedFailure, profileReadOnly;
    volatile boolean transientAuthorizationFailure, transientProfileFailure;
    int profileIsolation;
    final List<String> statements = new ArrayList<>();
    final List<Connection> profileConnections = new ArrayList<>();

    TrackingDataSource(DataSource target) {
      super(target);
    }

    @Override
    public Connection getConnection() throws SQLException {
      if (unavailable) throw new SQLTransientConnectionException("PRIVATE_CONNECTION_DETAIL");
      Connection connection = super.getConnection();
      return (Connection)
          Proxy.newProxyInstance(
              Connection.class.getClassLoader(),
              new Class<?>[] {Connection.class},
              (proxy, method, args) -> {
                if (method.getName().equals("prepareStatement") && args[0] instanceof String sql) {
                  statements.add(sql);
                  if (sql.contains("AS roles") && transientAuthorizationFailure)
                    throw new SQLTransientConnectionException(
                        "PRIVATE_AUTHORIZATION_DETAIL", "08006");
                  if (sql.contains("cafeteria_name")) {
                    profileReadOnly = connection.isReadOnly();
                    profileIsolation = connection.getTransactionIsolation();
                    if (unexpectedFailure) throw new SQLException("PRIVATE_SQL_DETAIL", "XX000");
                    if (transientProfileFailure)
                      throw new SQLTransientConnectionException("PRIVATE_PROFILE_DETAIL", "08006");
                  }
                  if (sql.contains("AS roles") || sql.contains("cafeteria_name"))
                    profileConnections.add(connection);
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
    @GetMapping("/api/test/worker-profile-unrelated")
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
        if (!binaries) throw new Error('Native PostgreSQL required for worker profile');
        const db = await createNativeAuthDatabase(binaries, { throughMigration: '014' });
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
    context = new AnnotationConfigWebApplicationContext();
    context.setServletContext(new MockServletContext());
    context.register(
        TestConfig.class,
        SecurityConfig.class,
        OrderAuthorization.class,
        AuthorizationPersistenceAdapter.class,
        WorkerProfilePersistenceAdapter.class,
        WorkerProfileService.class,
        WorkerProfileController.class,
        WorkerProfileExceptionHandler.class,
        GlobalExceptionHandler.class,
        UnrelatedController.class);
    context.refresh();
    mvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
  }

  static void seed() {
    for (UUID institution : List.of(INSTITUTION, OTHER_INSTITUTION))
      jdbc.update(
          "INSERT INTO public.institutions(id,name,email_domain,brand_name) VALUES (?,?,?,'Test')",
          institution,
          institution.equals(INSTITUTION) ? "Assigned institution" : "Other institution",
          institution + ".example.invalid");
    jdbc.update(
        "INSERT INTO public.sites(id,name,city,institution_id) VALUES (?,'Assigned site','Test',?)",
        SITE,
        INSTITUTION);
    jdbc.update(
        "INSERT INTO public.sites(id,name,city,institution_id) VALUES (?,'Other site','Test',?)",
        OTHER_SITE,
        OTHER_INSTITUTION);
    jdbc.update(
        "INSERT INTO public.cafeterias(id,site_id,name,is_active,lunch_order_start,lunch_order_end) VALUES (?,?,'Assigned cafeteria',false,'07:00','08:00')",
        CAFE,
        SITE);
    jdbc.update(
        "INSERT INTO public.cafeterias(id,site_id,name,is_active,lunch_order_start,lunch_order_end) VALUES (?,?,'Other cafeteria',false,'07:00','08:00')",
        OTHER_CAFE,
        OTHER_SITE);
    user(ADMIN, "ADMIN", CAFE, true);
    user(WORKER, "WORKER", CAFE, true);
    user(SECOND, "WORKER", OTHER_CAFE, true);
    user(INACTIVE, "WORKER", CAFE, false);
    user(UNASSIGNED, "WORKER", null, false);
    user(CLIENT, "CLIENT", null, true);
    user(SUPER, "SUPER_ADMIN", null, true);
    jdbc.update("UPDATE public.cafeterias SET is_active=true WHERE id=?", CAFE);
  }

  static void user(UUID id, String role, UUID cafe, boolean active) {
    jdbc.update(
        "INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES (?,?,'{\"full_name\":\"PRIVATE_NAME_DETAIL\",\"document\":\"PRIVATE_DOCUMENT_DETAIL\",\"phone\":\"PRIVATE_PHONE_DETAIL\",\"role\":\"SUPER_ADMIN\"}')",
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

  @BeforeEach
  void reset() {
    source.unavailable = source.unexpectedFailure = false;
    source.transientAuthorizationFailure = source.transientProfileFailure = false;
    source.statements.clear();
    source.profileConnections.clear();
    source.profileReadOnly = false;
    source.profileIsolation = 0;
  }

  @AfterEach
  void restoreFailures() {
    source.unavailable = source.unexpectedFailure = false;
    source.transientAuthorizationFailure = source.transientProfileFailure = false;
  }

  @AfterAll
  static void stop() throws Exception {
    if (context != null) context.close();
    if (database != null) {
      database.getOutputStream().write("stop\n".getBytes(StandardCharsets.UTF_8));
      database.getOutputStream().flush();
      assertTrue(database.waitFor(30, TimeUnit.SECONDS), "Owned PostgreSQL must shut down");
      assertEquals(0, database.exitValue());
    }
  }

  static RequestPostProcessor as(UUID user) {
    return jwt()
        .jwt(
            token ->
                token
                    .subject(user.toString())
                    .claim("role", "SUPER_ADMIN")
                    .claim("userId", SECOND.toString())
                    .claim("cafeteriaId", OTHER_CAFE.toString()))
        .authorities(new SimpleGrantedAuthority("ROLE_SUPER_ADMIN"));
  }

  @ParameterizedTest
  @ValueSource(booleans = {true, false})
  void validWorkerReadsOnlyItsBusinessContextIncludingInactiveCafeterias(boolean active)
      throws Exception {
    jdbc.update("UPDATE public.cafeterias SET is_active=? WHERE id=?", active, CAFE);
    try {
      var result =
          mvc.perform(get(ENDPOINT).with(as(WORKER)))
              .andExpect(status().isOk())
              .andExpect(header().string("Cache-Control", "no-store"))
              .andExpect(jsonPath("$.length()").value(4))
              .andExpect(jsonPath("$.role").value("WORKER"))
              .andExpect(jsonPath("$.cafeteria.length()").value(2))
              .andExpect(jsonPath("$.cafeteria.name").value("Assigned cafeteria"))
              .andExpect(jsonPath("$.cafeteria.active").value(active))
              .andExpect(jsonPath("$.site.length()").value(1))
              .andExpect(jsonPath("$.site.name").value("Assigned site"))
              .andExpect(jsonPath("$.institution.length()").value(1))
              .andExpect(jsonPath("$.institution.name").value("Assigned institution"))
              .andReturn();
      var json = result.getResponse().getContentAsString();
      for (String privateValue :
          List.of(
              WORKER.toString(),
              CAFE.toString(),
              SITE.toString(),
              INSTITUTION.toString(),
              "@example.invalid",
              "PRIVATE_",
              "fullName",
              "document",
              "phone",
              "metadata",
              "createdAt",
              "updatedAt"))
        assertFalse(json.contains(privateValue), "Business DTO must not expose " + privateValue);
    } finally {
      jdbc.update("UPDATE public.cafeterias SET is_active=true WHERE id=?", CAFE);
    }
  }

  @Test
  void noClientRowOrPersonalProfileIsRequired() throws Exception {
    assertEquals(
        0,
        jdbc.queryForObject(
            "SELECT count(*) FROM public.clients WHERE user_id=?", Integer.class, WORKER));
    mvc.perform(get(ENDPOINT).with(as(WORKER)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.email").doesNotExist())
        .andExpect(jsonPath("$.name").doesNotExist())
        .andExpect(jsonPath("$.document").doesNotExist())
        .andExpect(jsonPath("$.phone").doesNotExist());
  }

  @ParameterizedTest
  @ValueSource(strings = {"CLIENT", "ADMIN", "SUPER_ADMIN", "INACTIVE", "UNASSIGNED", "UNKNOWN"})
  void invalidBusinessIdentitiesAreForbiddenDespiteWorkerClaims(String identity) throws Exception {
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
        .andExpect(header().doesNotExist("Retry-After"))
        .andExpect(jsonPath("$.code").value("WORKER_PROFILE_FORBIDDEN"))
        .andExpect(content().string(not(containsString(user.toString()))));
  }

  @ParameterizedTest
  @ValueSource(strings = {"not-a-uuid", ""})
  void malformedJwtSubjectsCannotChooseAUser(String subject) throws Exception {
    mvc.perform(get(ENDPOINT).with(jwt().jwt(token -> token.subject(subject))))
        .andExpect(status().isForbidden())
        .andExpect(header().string("Cache-Control", "no-store"));
  }

  @Test
  void absentOrInvalidAuthenticationIs401() throws Exception {
    mvc.perform(get(ENDPOINT))
        .andExpect(status().isUnauthorized())
        .andExpect(header().string("Cache-Control", containsString("no-store")));
    mvc.perform(get(ENDPOINT).header("Authorization", "Bearer invalid"))
        .andExpect(status().isUnauthorized());
  }

  @Test
  void browserIdsAndRoleClaimsCannotOverrideTheVerifiedSubject() throws Exception {
    mvc.perform(
            get(ENDPOINT)
                .with(as(WORKER))
                .param("userId", SECOND.toString())
                .param("email", SECOND + "@example.invalid")
                .param("cafeteriaId", OTHER_CAFE.toString())
                .param("siteId", OTHER_SITE.toString())
                .param("institutionId", OTHER_INSTITUTION.toString()))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.cafeteria.name").value("Assigned cafeteria"))
        .andExpect(jsonPath("$.site.name").value("Assigned site"))
        .andExpect(jsonPath("$.institution.name").value("Assigned institution"));
    mvc.perform(get(ENDPOINT).with(as(SECOND)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.cafeteria.name").value("Other cafeteria"))
        .andExpect(jsonPath("$.site.name").value("Other site"))
        .andExpect(jsonPath("$.institution.name").value("Other institution"));
  }

  @Test
  void userRevocationIsObservedOnTheNextRequestWithoutChangingTheJwt() throws Exception {
    mvc.perform(get(ENDPOINT).with(as(WORKER))).andExpect(status().isOk());
    jdbc.update("UPDATE public.users SET is_active=false WHERE id=?", WORKER);
    try {
      mvc.perform(get(ENDPOINT).with(as(WORKER))).andExpect(status().isForbidden());
    } finally {
      jdbc.update("UPDATE public.users SET is_active=true WHERE id=?", WORKER);
    }
  }

  @Test
  void twoSelectsShareOneReadOnlySnapshotWithoutClientOrAuthTableQueries() throws Exception {
    String before = businessSnapshot();
    source.statements.clear();
    source.profileConnections.clear();
    mvc.perform(get(ENDPOINT).with(as(WORKER))).andExpect(status().isOk());
    assertEquals(
        2, source.statements.size(), "One authorization SELECT and one joined context SELECT");
    assertEquals(2, source.profileConnections.size());
    assertSame(source.profileConnections.getFirst(), source.profileConnections.getLast());
    assertTrue(source.profileReadOnly);
    assertEquals(Connection.TRANSACTION_REPEATABLE_READ, source.profileIsolation);
    for (var query : source.statements)
      assertFalse(query.contains("public.clients") || query.contains("auth.users"));
    assertEquals(before, businessSnapshot());
  }

  @Test
  void inactiveSiteAndInstitutionStillDescribeTheAssignedContext() throws Exception {
    jdbc.update("UPDATE public.sites SET is_active=false WHERE id=?", SITE);
    jdbc.update("UPDATE public.institutions SET is_active=false WHERE id=?", INSTITUTION);
    try {
      mvc.perform(get(ENDPOINT).with(as(WORKER)))
          .andExpect(status().isOk())
          .andExpect(jsonPath("$.site.name").value("Assigned site"))
          .andExpect(jsonPath("$.institution.name").value("Assigned institution"));
    } finally {
      jdbc.update("UPDATE public.sites SET is_active=true WHERE id=?", SITE);
      jdbc.update("UPDATE public.institutions SET is_active=true WHERE id=?", INSTITUTION);
    }
  }

  @ParameterizedTest
  @ValueSource(strings = {"cafeteria", "site", "institution"})
  void brokenMandatoryRelationsFailSafelyInsteadOfFabricatingAPartialProfile(String relation)
      throws Exception {
    String sql =
        switch (relation) {
          case "cafeteria" -> "UPDATE public.cafeteria_users SET cafeteria_id=? WHERE user_id=?";
          case "site" -> "UPDATE public.cafeterias SET site_id=? WHERE id=?";
          default -> "UPDATE public.sites SET institution_id=? WHERE id=?";
        };
    UUID row =
        switch (relation) {
          case "cafeteria" -> WORKER;
          case "site" -> CAFE;
          default -> SITE;
        };
    UUID original =
        switch (relation) {
          case "cafeteria" -> CAFE;
          case "site" -> SITE;
          default -> INSTITUTION;
        };
    // Only this owned, disposable cluster: model corrupted legacy data without changing schema.
    try (var connection = source.getConnection()) {
      connection.setAutoCommit(false);
      try (var setting = connection.createStatement()) {
        setting.execute("SET LOCAL session_replication_role='replica'");
      }
      try (var update = connection.prepareStatement(sql)) {
        update.setObject(1, UUID.randomUUID());
        update.setObject(2, row);
        update.executeUpdate();
      }
      connection.commit();
    }
    try {
      mvc.perform(get(ENDPOINT).with(as(WORKER)))
          .andExpect(status().isInternalServerError())
          .andExpect(header().string("Cache-Control", "no-store"))
          .andExpect(header().doesNotExist("Retry-After"))
          .andExpect(jsonPath("$.code").value("WORKER_PROFILE_INTERNAL_ERROR"))
          .andExpect(jsonPath("$.cafeteria").doesNotExist())
          .andExpect(content().string(not(containsString(row.toString()))));
    } finally {
      jdbc.update(sql, original, row);
    }
  }

  @Test
  void aBlankMandatoryNameIsAnInconsistencyNotAnEmptyProfile() throws Exception {
    jdbc.update("UPDATE public.cafeterias SET name=' ' WHERE id=?", CAFE);
    try {
      mvc.perform(get(ENDPOINT).with(as(WORKER)))
          .andExpect(status().isInternalServerError())
          .andExpect(jsonPath("$.code").value("WORKER_PROFILE_INTERNAL_ERROR"));
    } finally {
      jdbc.update("UPDATE public.cafeterias SET name='Assigned cafeteria' WHERE id=?", CAFE);
    }
  }

  @ParameterizedTest
  @ValueSource(strings = {"transaction", "authorization", "profile"})
  void temporaryFailureIsSafe503AndTheSameSessionCanRecover(String stage) throws Exception {
    source.unavailable = stage.equals("transaction");
    source.transientAuthorizationFailure = stage.equals("authorization");
    source.transientProfileFailure = stage.equals("profile");
    try {
      mvc.perform(get(ENDPOINT).with(as(WORKER)))
          .andExpect(status().isServiceUnavailable())
          .andExpect(header().string("Cache-Control", "no-store"))
          .andExpect(header().string("Retry-After", "5"))
          .andExpect(header().doesNotExist("Set-Cookie"))
          .andExpect(jsonPath("$.code").value("WORKER_PROFILE_TEMPORARILY_UNAVAILABLE"))
          .andExpect(content().string(not(containsString("PRIVATE_"))))
          .andExpect(content().string(not(containsString("SELECT"))));
    } finally {
      source.unavailable =
          source.transientAuthorizationFailure = source.transientProfileFailure = false;
    }
    mvc.perform(get(ENDPOINT).with(as(WORKER))).andExpect(status().isOk());
  }

  @Test
  void unexpectedQueryFailureDoesNotExposeTechnicalDetails() throws Exception {
    source.unexpectedFailure = true;
    mvc.perform(get(ENDPOINT).with(as(WORKER)))
        .andExpect(status().isInternalServerError())
        .andExpect(header().string("Cache-Control", "no-store"))
        .andExpect(header().doesNotExist("Retry-After"))
        .andExpect(jsonPath("$.code").value("WORKER_PROFILE_INTERNAL_ERROR"))
        .andExpect(content().string(not(containsString("PRIVATE_SQL_DETAIL"))))
        .andExpect(content().string(not(containsString("SELECT"))));
  }

  @Test
  void theScopedAdviceCannotReplaceOtherControllersErrorContracts() throws Exception {
    mvc.perform(get("/api/test/worker-profile-unrelated").with(as(WORKER)))
        .andExpect(status().isInternalServerError())
        .andExpect(jsonPath("$.code").value("INTERNAL_ERROR"));
  }

  @Test
  void post010BusinessGrantsRemainClosedForBrowserRoles() throws Exception {
    assertEquals(
        0,
        jdbc.queryForObject(
            """
        SELECT count(*) FROM (VALUES ('anon'),('authenticated')) a(actor)
        CROSS JOIN (VALUES ('users'),('cafeteria_users'),('cafeterias'),('sites'),('institutions')) t(name)
        CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE')) p(privilege)
        WHERE has_table_privilege(actor,('public.'||name)::regclass,privilege)
        """,
            Integer.class));
    mvc.perform(get(ENDPOINT).with(as(WORKER))).andExpect(status().isOk());
  }

  static String businessSnapshot() {
    return jdbc.queryForObject(
        """
        SELECT jsonb_build_object(
          'users',(SELECT jsonb_agg(to_jsonb(u) ORDER BY id) FROM public.users u),
          'assignments',(SELECT jsonb_agg(to_jsonb(cu) ORDER BY id) FROM public.cafeteria_users cu),
          'cafeterias',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.cafeterias c),
          'sites',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.sites s),
          'institutions',(SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM public.institutions i))::text
        """,
        String.class);
  }
}

package com.santotofood.config;

import static org.hamcrest.Matchers.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.santotofood.adapter.in.web.AdminCatalogController;
import com.santotofood.adapter.in.web.error.AdminCatalogExceptionHandler;
import com.santotofood.adapter.in.web.error.GlobalExceptionHandler;
import com.santotofood.adapter.out.persistence.AdminCatalogPersistenceAdapter;
import com.santotofood.adapter.out.persistence.AuthorizationPersistenceAdapter;
import com.santotofood.application.service.AdminCatalogService;
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

/** Real 001-015 PostgreSQL, actual security/policy/JDBC and no external database. */
@Timeout(60)
class AdminCatalogApiPostgresTest {
  static final String ENDPOINT = "/api/admin/catalog";
  static final UUID INSTITUTION = UUID.randomUUID(), OTHER_INSTITUTION = UUID.randomUUID();
  static final UUID SITE = UUID.randomUUID(), OTHER_SITE = UUID.randomUUID();
  static final UUID CAFE = UUID.randomUUID(), OTHER_CAFE = UUID.randomUUID();
  static final UUID ADMIN = UUID.randomUUID(), SECOND = UUID.randomUUID();
  static final UUID INACTIVE = UUID.randomUUID(), UNASSIGNED = UUID.randomUUID();
  static final UUID WORKER = UUID.randomUUID(),
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
                  if (sql.contains("FROM public.cafeterias c")) {
                    profileReadOnly = connection.isReadOnly();
                    profileIsolation = connection.getTransactionIsolation();
                    if (unexpectedFailure) throw new SQLException("PRIVATE_SQL_DETAIL", "XX000");
                    if (transientProfileFailure)
                      throw new SQLTransientConnectionException("PRIVATE_PROFILE_DETAIL", "08006");
                  }
                  if (sql.contains("AS roles") || sql.contains("FROM public.cafeterias c"))
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
    @GetMapping("/api/test/admin-catalog-unrelated")
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
        if (!binaries) throw new Error('Native PostgreSQL required for admin profile');
        const db = await createNativeAuthDatabase(binaries, { throughMigration: '015' });
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
    seedOwnProducts();
    product(UUID.randomUUID(), OTHER_CAFE, "FOREIGN_PRIVATE_PRODUCT", "ESPECIAL", true, null, null);
    context = new AnnotationConfigWebApplicationContext();
    context.setServletContext(new MockServletContext());
    context.register(
        TestConfig.class,
        SecurityConfig.class,
        OrderAuthorization.class,
        AuthorizationPersistenceAdapter.class,
        AdminCatalogPersistenceAdapter.class,
        AdminCatalogService.class,
        AdminCatalogController.class,
        AdminCatalogExceptionHandler.class,
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
    user(WORKER, "WORKER", CAFE, true);
    user(ADMIN, "ADMIN", CAFE, true);
    user(SECOND, "ADMIN", OTHER_CAFE, true);
    user(INACTIVE, "ADMIN", null, false);
    user(UNASSIGNED, "ADMIN", null, false);
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

  static void product(
      UUID id,
      UUID cafe,
      String name,
      String category,
      boolean active,
      String description,
      String image) {
    jdbc.update(
        "INSERT INTO public.lunches(id,cafeteria_id,name,category,price,is_active,description,image_url,stock) VALUES (?,?,?,?::public.catalog_category,18500.25,?,?,?,0)",
        id,
        cafe,
        name,
        category,
        active,
        description,
        image);
  }

  static void seedOwnProducts() {
    int index = 0;
    for (String category : List.of("DEL_DIA", "CORRIENTE", "EJECUTIVO", "ESPECIAL", "DESAYUNO")) {
      product(
          UUID.randomUUID(),
          CAFE,
          "Producto " + category,
          category,
          index % 2 == 0,
          index == 0 ? null : "Descripción",
          index++ == 0 ? null : "/unifood-logo.png");
    }
  }

  @ParameterizedTest
  @ValueSource(booleans = {true, false})
  void onlyTheAssignedCatalogIsReturnedIncludingInactiveProductsAndCafeterias(boolean active)
      throws Exception {
    jdbc.update("UPDATE public.cafeterias SET is_active=? WHERE id=?", active, CAFE);
    try {
      var result =
          mvc.perform(get(ENDPOINT).with(as(ADMIN)))
              .andExpect(status().isOk())
              .andExpect(header().string("Cache-Control", "no-store"))
              .andExpect(jsonPath("$.length()").value(1))
              .andExpect(jsonPath("$.products.length()").value(5))
              .andExpect(
                  jsonPath(
                      "$.products[*].category",
                      containsInAnyOrder(
                          "DEL_DIA", "CORRIENTE", "EJECUTIVO", "ESPECIAL", "DESAYUNO")))
              .andExpect(jsonPath("$.products[*].active", hasItems(true, false)))
              .andExpect(jsonPath("$.products[0].length()").value(7))
              .andExpect(jsonPath("$.products[*].price", everyItem(is("18500.25"))))
              .andReturn();
      String json = result.getResponse().getContentAsString();
      assertTrue(json.contains("\"description\":null"));
      assertTrue(json.contains("\"imageUrl\":null"));
      for (String field :
          List.of(
              "FOREIGN_PRIVATE_PRODUCT",
              CAFE.toString(),
              OTHER_CAFE.toString(),
              "stock",
              "available",
              "businessDate",
              "createdAt",
              "updatedAt",
              "client",
              "metadata")) assertFalse(json.contains(field), field);
    } finally {
      jdbc.update("UPDATE public.cafeterias SET is_active=true WHERE id=?", CAFE);
    }
  }

  @Test
  void browserSelectorsAndForgedRoleClaimsNeverSelectAnotherCafeteria() throws Exception {
    mvc.perform(
            get(ENDPOINT)
                .with(as(ADMIN))
                .param("cafeteriaId", OTHER_CAFE.toString())
                .param("userId", SECOND.toString())
                .param("institutionId", OTHER_INSTITUTION.toString())
                .param("siteId", OTHER_SITE.toString()))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.products.length()").value(5))
        .andExpect(content().string(not(containsString("FOREIGN_PRIVATE_PRODUCT"))));
    mvc.perform(get(ENDPOINT).with(as(SECOND)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.products.length()").value(1))
        .andExpect(jsonPath("$.products[0].name").value("FOREIGN_PRIVATE_PRODUCT"));
  }

  @ParameterizedTest
  @ValueSource(strings = {"CLIENT", "WORKER", "SUPER_ADMIN", "INACTIVE", "UNASSIGNED", "UNKNOWN"})
  void invalidBusinessIdentitiesAreDeniedDespiteJwtAdminMetadata(String identity) throws Exception {
    UUID user =
        switch (identity) {
          case "CLIENT" -> CLIENT;
          case "WORKER" -> WORKER;
          case "SUPER_ADMIN" -> SUPER;
          case "INACTIVE" -> INACTIVE;
          case "UNASSIGNED" -> UNASSIGNED;
          default -> UUID.randomUUID();
        };
    mvc.perform(
            get(ENDPOINT).with(jwt().jwt(t -> t.subject(user.toString()).claim("role", "ADMIN"))))
        .andExpect(status().isForbidden())
        .andExpect(header().string("Cache-Control", "no-store"))
        .andExpect(jsonPath("$.code").value("ADMIN_CATALOG_FORBIDDEN"))
        .andExpect(jsonPath("$.products").doesNotExist());
  }

  @Test
  void missingAndInvalidBearerAre401() throws Exception {
    mvc.perform(get(ENDPOINT)).andExpect(status().isUnauthorized());
    mvc.perform(get(ENDPOINT).header("Authorization", "Bearer invalid"))
        .andExpect(status().isUnauthorized());
  }

  @ParameterizedTest
  @ValueSource(strings = {"not-a-uuid", ""})
  void malformedSubjectCannotReachTheCatalog(String subject) throws Exception {
    mvc.perform(get(ENDPOINT).with(jwt().jwt(t -> t.subject(subject))))
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.products").doesNotExist());
  }

  @Test
  void validEmptyCatalogIs200AndExactDecimalSerializationIncludesNumericBoundary()
      throws Exception {
    jdbc.update("DELETE FROM public.lunches WHERE cafeteria_id=?", CAFE);
    try {
      mvc.perform(get(ENDPOINT).with(as(ADMIN)))
          .andExpect(status().isOk())
          .andExpect(jsonPath("$.products.length()").value(0));
      UUID id = UUID.randomUUID();
      product(id, CAFE, "Precio exacto", "CORRIENTE", false, null, null);
      jdbc.update("UPDATE public.lunches SET price=9999999999.99 WHERE id=?", id);
      mvc.perform(get(ENDPOINT).with(as(ADMIN)))
          .andExpect(status().isOk())
          .andExpect(jsonPath("$.products[0].price").value("9999999999.99"));
    } finally {
      jdbc.update("DELETE FROM public.lunches WHERE cafeteria_id=?", CAFE);
      seedOwnProducts();
    }
  }

  @Test
  void catalogAndAuthorizationUseTwoSelectsInOneReadOnlyRepeatableSnapshot() throws Exception {
    source.statements.clear();
    source.profileConnections.clear();
    String before =
        jdbc.queryForObject(
            "SELECT jsonb_agg(to_jsonb(l) ORDER BY id)::text FROM public.lunches l", String.class);
    source.statements.clear();
    mvc.perform(get(ENDPOINT).with(as(ADMIN))).andExpect(status().isOk());
    assertEquals(2, source.statements.size());
    assertEquals(2, source.profileConnections.size());
    assertSame(source.profileConnections.getFirst(), source.profileConnections.getLast());
    assertTrue(source.profileReadOnly);
    assertEquals(Connection.TRANSACTION_REPEATABLE_READ, source.profileIsolation);
    for (String sql : source.statements) {
      assertTrue(sql.stripLeading().startsWith("SELECT"));
      for (String table :
          List.of(
              "public.clients",
              "auth.users",
              "public.orders",
              "public.order_items",
              "daily_item_availability",
              "cafeteria_daily_states")) assertFalse(sql.contains(table));
    }
    assertEquals(
        before,
        jdbc.queryForObject(
            "SELECT jsonb_agg(to_jsonb(l) ORDER BY id)::text FROM public.lunches l", String.class));
  }

  @ParameterizedTest
  @ValueSource(strings = {"transaction", "authorization", "catalog"})
  void temporaryFailureIsSafe503AndRecoversWithTheSameJwt(String stage) throws Exception {
    source.unavailable = stage.equals("transaction");
    source.transientAuthorizationFailure = stage.equals("authorization");
    source.transientProfileFailure = stage.equals("catalog");
    try {
      mvc.perform(get(ENDPOINT).with(as(ADMIN)))
          .andExpect(status().isServiceUnavailable())
          .andExpect(header().string("Cache-Control", "no-store"))
          .andExpect(header().string("Retry-After", "5"))
          .andExpect(header().doesNotExist("Set-Cookie"))
          .andExpect(jsonPath("$.code").value("ADMIN_CATALOG_TEMPORARILY_UNAVAILABLE"))
          .andExpect(content().string(not(containsString("PRIVATE"))));
    } finally {
      source.unavailable =
          source.transientAuthorizationFailure = source.transientProfileFailure = false;
    }
    mvc.perform(get(ENDPOINT).with(as(ADMIN))).andExpect(status().isOk());
  }

  @Test
  void unexpectedFailureIsSanitizedAndAdviceIsScoped() throws Exception {
    source.unexpectedFailure = true;
    mvc.perform(get(ENDPOINT).with(as(ADMIN)))
        .andExpect(status().isInternalServerError())
        .andExpect(header().string("Cache-Control", "no-store"))
        .andExpect(header().doesNotExist("Retry-After"))
        .andExpect(jsonPath("$.code").value("ADMIN_CATALOG_INTERNAL_ERROR"))
        .andExpect(content().string(not(containsString("PRIVATE"))));
    mvc.perform(get("/api/test/admin-catalog-unrelated").with(as(ADMIN)))
        .andExpect(status().isInternalServerError())
        .andExpect(jsonPath("$.code").value("INTERNAL_ERROR"));
  }

  @Test
  void businessGrantsStayClosedForBothBrowserRolesIncludingColumns() {
    assertEquals(
        0,
        jdbc.queryForObject(
            """
      SELECT count(*) FROM (VALUES ('anon'),('authenticated')) a(actor)
      CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE')) p(privilege)
      WHERE has_table_privilege(actor,'public.lunches',privilege)
      """,
            Integer.class));
    assertEquals(
        0,
        jdbc.queryForObject(
            """
      SELECT count(*) FROM (VALUES ('anon'),('authenticated')) a(actor)
      CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE')) p(privilege)
      CROSS JOIN information_schema.columns c
      WHERE c.table_schema='public' AND c.table_name='lunches'
      AND has_column_privilege(actor,'public.lunches',c.column_name,privilege)
      """,
            Integer.class));
  }
}

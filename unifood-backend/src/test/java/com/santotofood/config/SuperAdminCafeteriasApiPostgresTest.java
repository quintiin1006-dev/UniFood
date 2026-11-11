package com.santotofood.config;

import static org.hamcrest.Matchers.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.santotofood.adapter.in.web.SuperAdminCafeteriaController;
import com.santotofood.adapter.in.web.error.GlobalExceptionHandler;
import com.santotofood.adapter.in.web.error.SuperAdminExceptionHandler;
import com.santotofood.adapter.out.persistence.AuthorizationPersistenceAdapter;
import com.santotofood.adapter.out.persistence.SuperAdminCafeteriaPersistenceAdapter;
import com.santotofood.application.service.SuperAdminCafeteriaService;
import jakarta.persistence.EntityManagerFactory;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import javax.sql.DataSource;
import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;
import org.springframework.mock.web.MockServletContext;
import org.springframework.orm.jpa.JpaTransactionManager;
import org.springframework.orm.jpa.LocalContainerEntityManagerFactoryBean;
import org.springframework.orm.jpa.persistenceunit.PersistenceManagedTypes;
import org.springframework.orm.jpa.vendor.HibernateJpaVendorAdapter;
import org.springframework.security.oauth2.jwt.BadJwtException;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.transaction.annotation.EnableTransactionManagement;
import org.springframework.web.context.support.AnnotationConfigWebApplicationContext;
import org.springframework.web.servlet.config.annotation.EnableWebMvc;

/**
 * SUPER_ADMIN cafeteria tree on the real 001-021 schema: the guard reads roles from PostgreSQL, and
 * the listing reports subscription and active ADMIN exactly as the database holds them.
 */
@Timeout(120)
class SuperAdminCafeteriasApiPostgresTest {
  static final String ENDPOINT = "/api/super-admin/cafeterias";
  static final UUID EMPTY_INSTITUTION = UUID.randomUUID();
  static final UUID SITE = UUID.randomUUID(), BARE_SITE = UUID.randomUUID();
  static final UUID CENTRAL = UUID.randomUUID(), NORTE = UUID.randomUUID(), SUR = UUID.randomUUID();
  static final UUID SUPER = UUID.randomUUID(), INACTIVE_SUPER = UUID.randomUUID();
  static final UUID ADMIN = UUID.randomUUID(), INACTIVE_ADMIN = UUID.randomUUID();
  static final UUID WORKER = UUID.randomUUID(), CLIENT = UUID.randomUUID();
  static UUID institution;
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
    LocalContainerEntityManagerFactoryBean entityManagerFactory(DataSource ds) {
      var factory = new LocalContainerEntityManagerFactoryBean();
      factory.setDataSource(ds);
      factory.setJpaVendorAdapter(new HibernateJpaVendorAdapter());
      // No entities: keep production's JPA transaction integration for REPEATABLE READ.
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
    String url = metadata.substring(metadata.indexOf("jdbc:"), metadata.lastIndexOf('"'));
    assertTrue(url.startsWith("jdbc:postgresql://127.0.0.1:"));
    dataSource = new DriverManagerDataSource(url, "postgres", "");
    jdbc = new JdbcTemplate(dataSource);
    seed();
    context = new AnnotationConfigWebApplicationContext();
    context.setServletContext(new MockServletContext());
    context.register(
        TestConfig.class,
        SecurityConfig.class,
        OrderAuthorization.class,
        AuthorizationPersistenceAdapter.class,
        SuperAdminCafeteriaPersistenceAdapter.class,
        SuperAdminCafeteriaService.class,
        SuperAdminCafeteriaController.class,
        SuperAdminExceptionHandler.class,
        GlobalExceptionHandler.class);
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

  // ---------------------------------------------------------------- fixture

  static void seed() {
    institution =
        jdbc.queryForObject(
            "SELECT id FROM public.institutions WHERE email_domain='ustavillavo.edu.co'",
            UUID.class);
    jdbc.update(
        "INSERT INTO public.institutions(id,name,email_domain,brand_name,is_active) VALUES (?,'Zeta sin sedes','zeta.example.invalid','Zeta',false)",
        EMPTY_INSTITUTION);
    jdbc.update(
        "INSERT INTO public.sites(id,name,city,institution_id) VALUES (?,'Sede Principal','Villavicencio',?)",
        SITE,
        institution);
    jdbc.update(
        "INSERT INTO public.sites(id,name,city,institution_id,is_active) VALUES (?,'Sede Vacía','Villavicencio',?,false)",
        BARE_SITE,
        institution);
    for (var cafe :
        Map.of(CENTRAL, "Cafetería Central", NORTE, "Cafetería Norte", SUR, "Cafetería Sur")
            .entrySet())
      jdbc.update(
          "INSERT INTO public.cafeterias(id,site_id,name,is_active,lunch_order_start,lunch_order_end) VALUES (?,?,?,false,'06:00','18:00')",
          cafe.getKey(),
          SITE,
          cafe.getValue());
    // 009: an active cafeteria needs its active, assigned ADMIN at commit.
    inTransaction(
        tx -> {
          staff(tx, ADMIN, "ADMIN", CENTRAL, true);
          tx.update("UPDATE public.cafeterias SET is_active=true WHERE id=?", CENTRAL);
        });
    inTransaction(tx -> staff(tx, INACTIVE_ADMIN, "ADMIN", NORTE, false));
    inTransaction(tx -> staff(tx, WORKER, "WORKER", SUR, true));
    inTransaction(tx -> staff(tx, SUPER, "SUPER_ADMIN", null, true));
    inTransaction(tx -> staff(tx, INACTIVE_SUPER, "SUPER_ADMIN", null, false));
    jdbc.update(
        "INSERT INTO auth.users(id,email) VALUES (?, ?)", CLIENT, CLIENT + "@ustavillavo.edu.co");
    jdbc.update(
        "INSERT INTO public.clients(user_id,full_name,institution_id,client_type,institutional_code) VALUES (?,'Ana Torres',?,'STUDENT','4000001')",
        CLIENT,
        institution);
    jdbc.update(
        "INSERT INTO public.user_roles(user_id,role_id) SELECT ?,id FROM public.roles WHERE name::text='CLIENT'",
        CLIENT);
    jdbc.update("UPDATE public.users SET is_active=true WHERE id=?", CLIENT);
  }

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

  static void staff(JdbcTemplate tx, UUID id, String role, UUID cafeteria, boolean active) {
    tx.update("INSERT INTO auth.users(id,email) VALUES (?, ?)", id, id + "@example.invalid");
    tx.update(
        "INSERT INTO public.user_roles(user_id,role_id) SELECT ?,id FROM public.roles WHERE name::text=?",
        id,
        role);
    if (cafeteria != null)
      tx.update(
          "INSERT INTO public.cafeteria_users(user_id,cafeteria_id) VALUES (?,?)", id, cafeteria);
    if (active) tx.update("UPDATE public.users SET is_active=true WHERE id=?", id);
  }

  /** Every token claims SUPER_ADMIN: only PostgreSQL may decide. */
  static RequestPostProcessor as(UUID user) {
    return jwt().jwt(token -> token.subject(user.toString()).claim("role", "SUPER_ADMIN"));
  }

  static String institutionPath(UUID id) {
    return "$.institutions[?(@.id=='" + id + "')]";
  }

  // ---------------------------------------------------------------- tests

  @Test
  void anonymousAndInvalidTokensAre401() throws Exception {
    mvc.perform(get(ENDPOINT)).andExpect(status().isUnauthorized());
    mvc.perform(get(ENDPOINT).header("Authorization", "Bearer invalid"))
        .andExpect(status().isUnauthorized());
  }

  @ParameterizedTest
  @ValueSource(strings = {"CLIENT", "WORKER", "ADMIN", "INACTIVE_SUPER", "UNKNOWN"})
  void otherRolesAndInactiveSuperAdminsAre403DespiteTheirClaims(String identity) throws Exception {
    UUID user =
        switch (identity) {
          case "CLIENT" -> CLIENT;
          case "WORKER" -> WORKER;
          case "ADMIN" -> ADMIN;
          case "INACTIVE_SUPER" -> INACTIVE_SUPER;
          default -> UUID.randomUUID();
        };
    mvc.perform(get(ENDPOINT).with(as(user)))
        .andExpect(status().isForbidden())
        .andExpect(header().string("Cache-Control", "no-store"))
        .andExpect(jsonPath("$.code").value("SUPER_ADMIN_FORBIDDEN"))
        .andExpect(jsonPath("$.institutions").doesNotExist())
        .andExpect(content().string(not(containsString("Cafetería"))));
  }

  @Test
  void superAdminSeesInstitutionsSitesAndCafeteriasWithSubscriptionAndAdmin() throws Exception {
    String main = institutionPath(institution);
    String site = "$.institutions[*].sites[?(@.id=='" + SITE + "')]";
    mvc.perform(get(ENDPOINT).with(as(SUPER)))
        .andExpect(status().isOk())
        .andExpect(header().string("Cache-Control", "no-store"))
        .andExpect(jsonPath(main + ".active").value(contains(true)))
        .andExpect(
            jsonPath(main + ".sites[*].name").value(contains("Sede Principal", "Sede Vacía")))
        .andExpect(jsonPath(main + ".sites[*].active").value(contains(true, false)))
        .andExpect(
            jsonPath("$.institutions[*].sites[?(@.id=='" + BARE_SITE + "')].cafeterias[*]")
                .value(empty()))
        .andExpect(jsonPath(site + ".city").value("Villavicencio"))
        .andExpect(
            jsonPath(site + ".cafeterias[*].name")
                .value(contains("Cafetería Central", "Cafetería Norte", "Cafetería Sur")))
        .andExpect(
            jsonPath(site + ".cafeterias[*].id")
                .value(contains(CENTRAL.toString(), NORTE.toString(), SUR.toString())))
        .andExpect(jsonPath(site + ".cafeterias[*].subscribed").value(contains(true, false, false)))
        // Norte has an assigned but inactive ADMIN; Sur only a WORKER.
        .andExpect(
            jsonPath(site + ".cafeterias[*].hasActiveAdmin").value(contains(true, false, false)))
        .andExpect(jsonPath(institutionPath(EMPTY_INSTITUTION) + ".active").value(contains(false)))
        .andExpect(jsonPath(institutionPath(EMPTY_INSTITUTION) + ".sites[*]").value(empty()))
        .andExpect(content().string(not(containsString("@example.invalid"))))
        .andExpect(content().string(not(containsString(ADMIN.toString()))))
        .andExpect(content().string(not(containsString("Ana Torres"))));
  }

  @Test
  void revocationIsObservedOnTheNextRequestWithoutChangingTheJwt() throws Exception {
    mvc.perform(get(ENDPOINT).with(as(SUPER))).andExpect(status().isOk());
    jdbc.update("UPDATE public.users SET is_active=false WHERE id=?", SUPER);
    try {
      mvc.perform(get(ENDPOINT).with(as(SUPER)))
          .andExpect(status().isForbidden())
          .andExpect(jsonPath("$.code").value("SUPER_ADMIN_FORBIDDEN"));
    } finally {
      jdbc.update("UPDATE public.users SET is_active=true WHERE id=?", SUPER);
    }
  }

  @Test
  void theListingWritesNothing() throws Exception {
    String before = businessSnapshot();
    mvc.perform(get(ENDPOINT).with(as(SUPER))).andExpect(status().isOk());
    assertEquals(before, businessSnapshot());
  }

  static String businessSnapshot() {
    return jdbc.queryForObject(
        """
        SELECT jsonb_build_object(
          'users',(SELECT jsonb_agg(to_jsonb(u) ORDER BY id) FROM public.users u),
          'roles',(SELECT jsonb_agg(to_jsonb(ur) ORDER BY user_id) FROM public.user_roles ur),
          'assignments',(SELECT jsonb_agg(to_jsonb(cu) ORDER BY id) FROM public.cafeteria_users cu),
          'cafeterias',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.cafeterias c),
          'sites',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.sites s),
          'institutions',(SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM public.institutions i))::text
        """,
        String.class);
  }
}

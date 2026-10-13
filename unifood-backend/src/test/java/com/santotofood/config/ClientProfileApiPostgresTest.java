package com.santotofood.config;

import static org.hamcrest.Matchers.hasSize;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.santotofood.adapter.in.web.ClientProfileController;
import com.santotofood.adapter.in.web.error.ClientProfileExceptionHandler;
import com.santotofood.adapter.in.web.error.GlobalExceptionHandler;
import com.santotofood.adapter.out.persistence.AuthorizationPersistenceAdapter;
import com.santotofood.adapter.out.persistence.ClientProfilePersistenceAdapter;
import com.santotofood.application.service.ClientProfileService;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.SQLException;
import java.sql.SQLTransientConnectionException;
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
import org.springframework.jdbc.datasource.DelegatingDataSource;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.mock.web.MockServletContext;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.jwt.BadJwtException;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.support.AnnotationConfigWebApplicationContext;
import org.springframework.web.servlet.config.annotation.EnableWebMvc;

/** HTTP guards, JDBC adapters and use case against the real post-011 PostgreSQL schema. */
@Timeout(60)
class ClientProfileApiPostgresTest {
  static final UUID FIRST = UUID.randomUUID();
  static final UUID SECOND = UUID.randomUUID();
  static final UUID INACTIVE = UUID.randomUUID();
  static final UUID MISSING_PROFILE = UUID.randomUUID();
  static final UUID REVOKED = UUID.randomUUID();
  static final UUID HIDDEN_INSTITUTION = UUID.randomUUID();
  static final Map<String, UUID> STAFF =
      Map.of(
          "WORKER",
          UUID.randomUUID(),
          "ADMIN",
          UUID.randomUUID(),
          "SUPER_ADMIN",
          UUID.randomUUID());
  static Process database;
  static AnnotationConfigWebApplicationContext context;
  static FailingDataSource dataSource;
  static JdbcTemplate jdbc;
  static MockMvc mvc;

  @Configuration
  @EnableWebMvc
  static class TestConfig {
    @Bean
    DataSource dataSource() {
      return dataSource;
    }

    @Bean
    JdbcTemplate jdbc(DataSource source) {
      return new JdbcTemplate(source);
    }

    @Bean
    JwtDecoder jwtDecoder() {
      JwtDecoder decoder = mock(JwtDecoder.class);
      when(decoder.decode(anyString())).thenThrow(new BadJwtException("Rejected test token"));
      return decoder;
    }
  }

  static class FailingDataSource extends DelegatingDataSource {
    volatile boolean unavailable;

    FailingDataSource(DataSource target) {
      super(target);
    }

    @Override
    public Connection getConnection() throws SQLException {
      if (unavailable) throw new SQLTransientConnectionException("PRIVATE_CONNECTION_DETAIL");
      return super.getConnection();
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
    dataSource = new FailingDataSource(new DriverManagerDataSource(url, "postgres", ""));
    jdbc = new JdbcTemplate(dataSource);
    seed();
    context = new AnnotationConfigWebApplicationContext();
    context.setServletContext(new MockServletContext());
    context.register(
        TestConfig.class,
        SecurityConfig.class,
        OrderAuthorization.class,
        AuthorizationPersistenceAdapter.class,
        ClientProfilePersistenceAdapter.class,
        ClientProfileService.class,
        ClientProfileController.class,
        ClientProfileExceptionHandler.class,
        GlobalExceptionHandler.class);
    context.refresh();
    mvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
  }

  static void student(UUID id, String email, String document) {
    jdbc.update(
        "INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES (?, ?, ?::jsonb)",
        id,
        email,
        "{\"registration_type\":\"student\",\"full_name\":\"Profile test\",\"document\":\""
            + document
            + "\",\"role\":\"SUPER_ADMIN\"}");
  }

  static void provision(UUID id, String role, UUID cafeteria) {
    jdbc.update(
        "INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES (?, ?, '{\"role\":\"CLIENT\"}')",
        id,
        id + "@example.invalid");
    jdbc.update(
        "INSERT INTO public.user_roles(user_id,role_id) SELECT ?,id FROM public.roles WHERE name::text=?",
        id,
        role);
    if (cafeteria != null)
      jdbc.update(
          "INSERT INTO public.cafeteria_users(user_id,cafeteria_id) VALUES (?,?)", id, cafeteria);
    jdbc.update("UPDATE public.users SET is_active=true WHERE id=?", id);
  }

  static void seed() {
    jdbc.update(
        "INSERT INTO public.institutions(name,email_domain,brand_name) VALUES ('Other university','other.example.invalid','Test')");
    student(FIRST, "first@ustavillavo.edu.co", "PROFILE-001");
    student(SECOND, "second@other.example.invalid", "PROFILE-002");
    student(INACTIVE, "inactive@ustavillavo.edu.co", "PROFILE-INACTIVE");
    student(REVOKED, "revoked@ustavillavo.edu.co", "PROFILE-REVOKED");
    student(HIDDEN_INSTITUTION, "hidden@other.example.invalid", "PROFILE-HIDDEN");
    jdbc.update("UPDATE public.clients SET phone='3001234567' WHERE user_id=?", FIRST);
    jdbc.update("UPDATE public.users SET is_active=false WHERE id=?", INACTIVE);
    UUID site = UUID.randomUUID(), cafe = UUID.randomUUID();
    jdbc.update(
        "INSERT INTO public.sites(id,name,city,institution_id) SELECT ?, 'Profile tests','test',id FROM public.institutions WHERE email_domain='ustavillavo.edu.co'",
        site);
    jdbc.update(
        "INSERT INTO public.cafeterias(id,site_id,name,is_active,lunch_order_start,lunch_order_end) VALUES (?,?,'Profile tests',false,'07:00','08:00')",
        cafe,
        site);
    STAFF.forEach((role, id) -> provision(id, role, role.equals("SUPER_ADMIN") ? null : cafe));
    provision(MISSING_PROFILE, "CLIENT", null);
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

  static RequestPostProcessor verified(UUID subject) {
    return jwt()
        .jwt(
            token ->
                token
                    .subject(subject.toString())
                    .claim("role", "CLIENT")
                    .claim("userId", SECOND.toString())
                    .claim("user_metadata", Map.of("role", "CLIENT", "userId", SECOND.toString())))
        .authorities(new SimpleGrantedAuthority("ROLE_CLIENT"));
  }

  @Test
  void clientReadsOnlyItsOwnMinimalProfileDespiteForgedBusinessIdsAndClaims() throws Exception {
    mvc.perform(
            get("/api/me/profile")
                .with(verified(FIRST))
                .queryParam("userId", SECOND.toString())
                .queryParam("clientId", SECOND.toString())
                .queryParam("institutionId", SECOND.toString()))
        .andExpect(status().isOk())
        .andExpect(header().string("Cache-Control", "no-store"))
        .andExpect(jsonPath("$.*", hasSize(3)))
        .andExpect(jsonPath("$.document").value("PROFILE-001"))
        .andExpect(jsonPath("$.phone").value("3001234567"))
        .andExpect(jsonPath("$.institution").value("Universidad Santo Tomás"));
  }

  @Test
  void identityRolesComeFromDatabaseInsteadOfJwtAuthoritiesOrMetadata() throws Exception {
    mvc.perform(
            get("/api/me/profile")
                .with(
                    jwt()
                        .jwt(token -> token.subject(FIRST.toString()).claim("role", "SUPER_ADMIN"))
                        .authorities(new SimpleGrantedAuthority("ROLE_ADMIN"))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.document").value("PROFILE-001"));
  }

  @Test
  void nullablePhoneAndAnInactiveInstitutionPreserveTheExistingPartialProfile() throws Exception {
    mvc.perform(get("/api/me/profile").with(verified(SECOND)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.*", hasSize(3)))
        .andExpect(jsonPath("$.phone").doesNotExist())
        .andExpect(jsonPath("$.institution").value("Other university"));
    try {
      jdbc.update(
          "UPDATE public.institutions SET is_active=false WHERE email_domain='other.example.invalid'");
      mvc.perform(get("/api/me/profile").with(verified(HIDDEN_INSTITUTION)))
          .andExpect(status().isOk())
          .andExpect(jsonPath("$.*", hasSize(3)))
          .andExpect(jsonPath("$.document").value("PROFILE-HIDDEN"))
          .andExpect(jsonPath("$.institution").doesNotExist());
    } finally {
      jdbc.update(
          "UPDATE public.institutions SET is_active=true WHERE email_domain='other.example.invalid'");
    }
  }

  @ParameterizedTest
  @ValueSource(strings = {"WORKER", "ADMIN", "SUPER_ADMIN"})
  void nonClientsAreDeniedEvenWithClientClaims(String role) throws Exception {
    mvc.perform(get("/api/me/profile").with(verified(STAFF.get(role))))
        .andExpect(status().isForbidden())
        .andExpect(header().string("Cache-Control", "no-store"))
        .andExpect(jsonPath("$.code").value("FORBIDDEN"))
        .andExpect(jsonPath("$.document").doesNotExist());
  }

  @Test
  void inactiveAndUnprovisionedUsersAreDenied() throws Exception {
    for (UUID subject : new UUID[] {INACTIVE, UUID.randomUUID()})
      mvc.perform(get("/api/me/profile").with(verified(subject)))
          .andExpect(status().isForbidden())
          .andExpect(jsonPath("$.code").value("FORBIDDEN"));
  }

  @Test
  void revocationIsObservedOnTheNextRequestWithTheSameJwt() throws Exception {
    mvc.perform(get("/api/me/profile").with(verified(REVOKED))).andExpect(status().isOk());
    jdbc.update(
        "UPDATE public.user_roles SET role_id=(SELECT id FROM public.roles WHERE name='SUPER_ADMIN') WHERE user_id=?",
        REVOKED);
    mvc.perform(get("/api/me/profile").with(verified(REVOKED))).andExpect(status().isForbidden());
  }

  @Test
  void missingBusinessProfileHasASafe404Contract() throws Exception {
    mvc.perform(get("/api/me/profile").with(verified(MISSING_PROFILE)))
        .andExpect(status().isNotFound())
        .andExpect(header().string("Cache-Control", "no-store"))
        .andExpect(jsonPath("$.code").value("CLIENT_PROFILE_NOT_FOUND"))
        .andExpect(jsonPath("$.message").value("No se encontró el perfil de tu cuenta."));
  }

  @Test
  void anonymousForgedAndMalformedIdentitiesCannotReadAProfile() throws Exception {
    mvc.perform(get("/api/me/profile")).andExpect(status().isUnauthorized());
    mvc.perform(get("/api/me/profile").header("Authorization", "Bearer forged-token"))
        .andExpect(status().isUnauthorized());
    mvc.perform(get("/api/me/profile").with(jwt().jwt(token -> token.subject("not-a-uuid"))))
        .andExpect(status().isForbidden());
  }

  @Test
  void temporaryDatabaseFailureDuringAuthorizationIs503AndRecoversWithoutTechnicalDetails()
      throws Exception {
    try {
      dataSource.unavailable = true;
      var result =
          mvc.perform(get("/api/me/profile").with(verified(FIRST)))
              .andExpect(status().isServiceUnavailable())
              .andExpect(header().string("Cache-Control", "no-store"))
              .andExpect(header().string("Retry-After", "5"))
              .andExpect(jsonPath("$.code").value("CLIENT_PROFILE_TEMPORARILY_UNAVAILABLE"))
              .andReturn();
      assertFalse(result.getResponse().getContentAsString().contains("PRIVATE"));
    } finally {
      dataSource.unavailable = false;
    }
    mvc.perform(get("/api/me/profile").with(verified(FIRST))).andExpect(status().isOk());
  }

  @Test
  void post010BrowserTableAndColumnGrantsStayClosedWhileSpringCanReadTheProfile() throws Exception {
    for (String role : new String[] {"anon", "authenticated"}) {
      for (String table : new String[] {"clients", "institutions"})
        assertFalse(
            jdbc.queryForObject(
                "SELECT has_table_privilege(?,?,'SELECT')",
                Boolean.class,
                role,
                "public." + table));
      assertFalse(
          jdbc.queryForObject(
              "SELECT has_column_privilege(?,'public.clients','document','SELECT')",
              Boolean.class,
              role));
    }
    mvc.perform(get("/api/me/profile").with(verified(FIRST)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.document").value("PROFILE-001"));
  }
}

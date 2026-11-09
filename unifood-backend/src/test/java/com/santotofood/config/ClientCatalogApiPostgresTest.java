package com.santotofood.config;

import static org.hamcrest.Matchers.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.santotofood.adapter.in.web.ClientCatalogController;
import com.santotofood.adapter.in.web.error.ClientCatalogExceptionHandler;
import com.santotofood.adapter.in.web.error.GlobalExceptionHandler;
import com.santotofood.adapter.out.persistence.AuthorizationPersistenceAdapter;
import com.santotofood.adapter.out.persistence.ClientCatalogPersistenceAdapter;
import com.santotofood.adapter.out.time.SystemTimeProvider;
import com.santotofood.application.service.ClientCatalogService;
import com.santotofood.domain.model.BusinessDate;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
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
import org.springframework.mock.web.MockServletContext;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.jwt.BadJwtException;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.support.AnnotationConfigWebApplicationContext;
import org.springframework.web.servlet.config.annotation.EnableWebMvc;

/** Client context and menu: HTTP guards, JDBC and use case on the real 001-021 schema. */
@Timeout(90)
class ClientCatalogApiPostgresTest {
  static final UUID STUDENT = UUID.randomUUID();
  static final UUID ORDERING = UUID.randomUUID();
  static final UUID OTHER_STUDENT = UUID.randomUUID();
  static final UUID NO_PROFILE = UUID.randomUUID();
  static final UUID OPEN = UUID.randomUUID();
  static final UUID CLOSED = UUID.randomUUID();
  static final UUID INACTIVE = UUID.randomUUID();
  static final UUID FOREIGN = UUID.randomUUID();
  static final UUID JUICE = UUID.randomUUID();
  static final UUID LUNCH = UUID.randomUUID();
  static final UUID ORDER = UUID.randomUUID();
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
  static DataSource dataSource;
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
        ClientCatalogPersistenceAdapter.class,
        SystemTimeProvider.class,
        ClientCatalogService.class,
        ClientCatalogController.class,
        ClientCatalogExceptionHandler.class,
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

  // Fixture identities stand for the server's Admin API path (preauthorized).
  static void student(UUID id, String email, String institutionDomain, String document) {
    jdbc.update("INSERT INTO auth.users(id,email) VALUES (?, ?)", id, email);
    jdbc.update(
        "INSERT INTO public.clients(user_id,full_name,document,institution_id,client_type,institutional_code) "
            + "SELECT ?,'Ana Torres',?,id,'STUDENT',? FROM public.institutions WHERE email_domain=?",
        id,
        document,
        String.valueOf(7000000 + Math.abs(id.hashCode() % 999999)),
        institutionDomain);
    jdbc.update(
        "INSERT INTO public.user_roles(user_id,role_id) SELECT ?,id FROM public.roles WHERE name::text='CLIENT'",
        id);
    jdbc.update("UPDATE public.users SET is_active=true WHERE id=?", id);
  }

  static void staff(UUID id, String role, UUID cafeteria) {
    jdbc.update("INSERT INTO auth.users(id,email) VALUES (?, ?)", id, id + "@example.invalid");
    jdbc.update(
        "INSERT INTO public.user_roles(user_id,role_id) SELECT ?,id FROM public.roles WHERE name::text=?",
        id,
        role);
    if (cafeteria != null)
      jdbc.update(
          "INSERT INTO public.cafeteria_users(user_id,cafeteria_id) VALUES (?,?)", id, cafeteria);
    jdbc.update("UPDATE public.users SET is_active=true WHERE id=?", id);
  }

  static void cafeteria(UUID id, UUID site, String name) {
    jdbc.update(
        "INSERT INTO public.cafeterias(id,site_id,name,is_active,lunch_order_start,lunch_order_end) VALUES (?,?,?,false,'06:00','18:00')",
        id,
        site,
        name);
  }

  static UUID site(String domain, String name) {
    UUID id = UUID.randomUUID();
    jdbc.update(
        "INSERT INTO public.sites(id,name,city,institution_id) SELECT ?,?,'Villavicencio',id FROM public.institutions WHERE email_domain=?",
        id,
        name,
        domain);
    return id;
  }

  static void product(UUID id, UUID cafeteria, String name, String category, int price) {
    jdbc.update(
        "INSERT INTO public.lunches(id,cafeteria_id,name,description,price,category) VALUES (?,?,?,?,?,?::public.catalog_category)",
        id,
        cafeteria,
        name,
        "Descripción de " + name,
        price,
        category);
  }

  static void seed() {
    var today = BusinessDate.from(Instant.now()).value();
    jdbc.update(
        "INSERT INTO public.institutions(name,email_domain,brand_name) VALUES ('Otra universidad','other.example.invalid','Otra')");
    UUID main = site("ustavillavo.edu.co", "Sede Principal");
    UUID foreignSite = site("other.example.invalid", "Sede ajena");
    cafeteria(OPEN, main, "Cafetería Central");
    cafeteria(CLOSED, main, "Cafetería Norte");
    cafeteria(INACTIVE, main, "Cafetería Inactiva");
    cafeteria(FOREIGN, foreignSite, "Cafetería ajena");
    // 009: an active cafeteria needs its active ADMIN in the same transaction.
    for (UUID cafe : new UUID[] {OPEN, CLOSED, FOREIGN}) {
      UUID admin = UUID.randomUUID();
      jdbc.execute(
          (java.sql.Connection connection) -> {
            connection.setAutoCommit(false);
            var tx =
                new JdbcTemplate(
                    new org.springframework.jdbc.datasource.SingleConnectionDataSource(
                        connection, true));
            tx.update(
                "INSERT INTO auth.users(id,email) VALUES (?, ?)",
                admin,
                admin + "@example.invalid");
            tx.update(
                "INSERT INTO public.user_roles(user_id,role_id) SELECT ?,id FROM public.roles WHERE name::text='ADMIN'",
                admin);
            tx.update(
                "INSERT INTO public.cafeteria_users(user_id,cafeteria_id) VALUES (?,?)",
                admin,
                cafe);
            tx.update("UPDATE public.users SET is_active=true WHERE id=?", admin);
            tx.update("UPDATE public.cafeterias SET is_active=true WHERE id=?", cafe);
            connection.commit();
            connection.setAutoCommit(true);
            return null;
          });
    }
    product(JUICE, OPEN, "Jugo natural", "BEBIDA", 4500);
    product(LUNCH, OPEN, "Corriente del día", "CORRIENTE", 13000);
    product(UUID.randomUUID(), OPEN, "Plato retirado", "EJECUTIVO", 19000);
    jdbc.update("UPDATE public.lunches SET is_active=false WHERE name='Plato retirado'");
    product(UUID.randomUUID(), CLOSED, "Calentado con huevo", "DESAYUNO", 9500);
    product(UUID.randomUUID(), FOREIGN, "Plato ajeno", "CORRIENTE", 11000);
    jdbc.update(
        "INSERT INTO public.cafeteria_daily_states(cafeteria_id,business_date,is_open) VALUES (?,?,true),(?,?,false)",
        OPEN,
        today,
        CLOSED,
        today);
    // Juice available today, lunch not marked: no row means unavailable.
    jdbc.update(
        "INSERT INTO public.daily_item_availability(cafeteria_id,item_id,business_date,is_available) VALUES (?,?,?,true)",
        OPEN,
        JUICE,
        today);
    student(STUDENT, "ana@ustavillavo.edu.co", "ustavillavo.edu.co", null);
    student(ORDERING, "eva@ustavillavo.edu.co", "ustavillavo.edu.co", "DOC-PRIVATE");
    student(OTHER_STUDENT, "otra@other.example.invalid", "other.example.invalid", null);
    jdbc.update(
        "INSERT INTO public.orders(id,cafeteria_id,client_id,client_name,total) SELECT ?,?,id,'Eva',13000 FROM public.clients WHERE user_id=?",
        ORDER,
        OPEN,
        ORDERING);
    // 009: one ADMIN per cafeteria, so the denied ADMIN takes the inactive one.
    STAFF.forEach(
        (role, id) ->
            staff(
                id,
                role,
                switch (role) {
                  case "SUPER_ADMIN" -> null;
                  case "ADMIN" -> INACTIVE;
                  default -> OPEN;
                }));
    staff(NO_PROFILE, "CLIENT", null);
  }

  static RequestPostProcessor as(UUID subject) {
    return jwt()
        .jwt(
            token ->
                token
                    .subject(subject.toString())
                    .claim("role", "CLIENT")
                    .claim("user_metadata", Map.of("role", "CLIENT", "institutionId", "forged")))
        .authorities(new SimpleGrantedAuthority("ROLE_CLIENT"));
  }

  @Test
  void contextListsTheActiveCafeteriasOfTheClientsInstitutionWithTodaysState() throws Exception {
    mvc.perform(get("/api/me/context").with(as(STUDENT)).queryParam("institutionId", "forged"))
        .andExpect(status().isOk())
        .andExpect(header().string("Cache-Control", "no-store"))
        .andExpect(jsonPath("$.fullName").value("Ana Torres"))
        .andExpect(jsonPath("$.clientType").value("STUDENT"))
        .andExpect(jsonPath("$.institution.name").value("Universidad Santo Tomás"))
        .andExpect(jsonPath("$.sites", hasSize(1)))
        .andExpect(jsonPath("$.sites[0].name").value("Sede Principal"))
        .andExpect(
            jsonPath(
                "$.sites[0].cafeterias[*].name", contains("Cafetería Central", "Cafetería Norte")))
        .andExpect(jsonPath("$.sites[0].cafeterias[*].open", contains(true, false)))
        .andExpect(jsonPath("$.activeOrder").value(nullValue()))
        .andExpect(jsonPath("$..document").isEmpty())
        .andExpect(content().string(not(containsString("Cafetería ajena"))))
        .andExpect(content().string(not(containsString("Cafetería Inactiva"))));
  }

  @Test
  void contextReportsTheActiveOrderIdOnlyAndNeverTheDocument() throws Exception {
    mvc.perform(get("/api/me/context").with(as(ORDERING)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.activeOrder.id").value(ORDER.toString()))
        .andExpect(jsonPath("$.activeOrder.*", hasSize(1)))
        .andExpect(content().string(not(containsString("DOC-PRIVATE"))));
  }

  @Test
  void otherInstitutionSeesOnlyItsOwnCafeteria() throws Exception {
    mvc.perform(get("/api/me/context").with(as(OTHER_STUDENT)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.sites", hasSize(1)))
        .andExpect(jsonPath("$.sites[0].cafeterias", hasSize(1)))
        .andExpect(jsonPath("$.sites[0].cafeterias[0].name").value("Cafetería ajena"))
        .andExpect(content().string(not(containsString("Cafetería Central"))));
  }

  @Test
  void menuGroupsActiveProductsAndMarksTodaysAvailability() throws Exception {
    mvc.perform(get("/api/me/menu").with(as(STUDENT)).queryParam("cafeteriaId", OPEN.toString()))
        .andExpect(status().isOk())
        .andExpect(header().string("Cache-Control", "no-cache, private"))
        .andExpect(header().exists("ETag"))
        .andExpect(jsonPath("$.cafeteria.open").value(true))
        .andExpect(
            jsonPath("$.businessDate").value(BusinessDate.from(Instant.now()).value().toString()))
        .andExpect(jsonPath("$.categories[*].id", contains("CORRIENTE", "BEBIDA")))
        .andExpect(jsonPath("$.categories[0].products[0].name").value("Corriente del día"))
        .andExpect(jsonPath("$.categories[0].products[0].price").value("13000.00"))
        .andExpect(jsonPath("$.categories[0].products[0].available").value(false))
        .andExpect(jsonPath("$.categories[1].products[0].available").value(true))
        .andExpect(content().string(not(containsString("Plato retirado"))));
  }

  @Test
  void closedCafeteriaShowsItsProductsButNoneAvailable() throws Exception {
    mvc.perform(get("/api/me/menu").with(as(STUDENT)).queryParam("cafeteriaId", CLOSED.toString()))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.cafeteria.open").value(false))
        .andExpect(jsonPath("$.categories[0].products[0].name").value("Calentado con huevo"))
        .andExpect(jsonPath("$.categories[*].products[*].available", everyItem(is(false))));
  }

  @Test
  void foreignAndMissingCafeteriasAreTheSameNotFound() throws Exception {
    String foreign =
        mvc.perform(
                get("/api/me/menu").with(as(STUDENT)).queryParam("cafeteriaId", FOREIGN.toString()))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.code").value("CAFETERIA_NOT_FOUND"))
            .andExpect(content().string(not(containsString("Plato ajeno"))))
            .andReturn()
            .getResponse()
            .getContentAsString();
    String missing =
        mvc.perform(
                get("/api/me/menu")
                    .with(as(STUDENT))
                    .queryParam("cafeteriaId", UUID.randomUUID().toString()))
            .andExpect(status().isNotFound())
            .andReturn()
            .getResponse()
            .getContentAsString();
    assertEquals(
        foreign.replaceAll("\"timestamp\":\"[^\"]+\"", "").replaceAll("\"path\":\"[^\"]+\"", ""),
        missing.replaceAll("\"timestamp\":\"[^\"]+\"", "").replaceAll("\"path\":\"[^\"]+\"", ""));
    // The foreign institution's own client reads it normally.
    mvc.perform(
            get("/api/me/menu")
                .with(as(OTHER_STUDENT))
                .queryParam("cafeteriaId", FOREIGN.toString()))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.categories[0].products[0].name").value("Plato ajeno"));
  }

  @Test
  void inactiveCafeteriaOfTheOwnInstitutionIsNotSubscribed() throws Exception {
    mvc.perform(
            get("/api/me/menu").with(as(STUDENT)).queryParam("cafeteriaId", INACTIVE.toString()))
        .andExpect(status().isForbidden())
        .andExpect(header().string("Cache-Control", "no-store"))
        .andExpect(jsonPath("$.code").value("CAFETERIA_NOT_SUBSCRIBED"))
        .andExpect(jsonPath("$.message").value("Esta cafetería no está disponible en UniFood."));
  }

  @Test
  void menuAnswersNotModifiedForTheCurrentEtagAndChangesWhenAvailabilityChanges() throws Exception {
    String etag =
        mvc.perform(
                get("/api/me/menu").with(as(STUDENT)).queryParam("cafeteriaId", OPEN.toString()))
            .andExpect(status().isOk())
            .andReturn()
            .getResponse()
            .getHeader("ETag");
    assertNotNull(etag);
    for (String header : new String[] {etag, "W/" + etag, "\"other\", " + etag, "*"})
      mvc.perform(
              get("/api/me/menu")
                  .with(as(STUDENT))
                  .queryParam("cafeteriaId", OPEN.toString())
                  .header("If-None-Match", header))
          .andExpect(status().isNotModified())
          .andExpect(header().string("ETag", etag))
          .andExpect(content().string(""));
    var today = BusinessDate.from(Instant.now()).value();
    jdbc.update(
        "INSERT INTO public.daily_item_availability(cafeteria_id,item_id,business_date,is_available) VALUES (?,?,?,true)",
        OPEN,
        LUNCH,
        today);
    try {
      mvc.perform(
              get("/api/me/menu")
                  .with(as(STUDENT))
                  .queryParam("cafeteriaId", OPEN.toString())
                  .header("If-None-Match", etag))
          .andExpect(status().isOk())
          .andExpect(header().string("ETag", not(etag)))
          .andExpect(jsonPath("$.categories[0].products[0].available").value(true));
    } finally {
      jdbc.update("DELETE FROM public.daily_item_availability WHERE item_id=?", LUNCH);
    }
  }

  @ParameterizedTest
  @ValueSource(strings = {"WORKER", "ADMIN", "SUPER_ADMIN"})
  void nonClientsAreDeniedEvenWithClientClaims(String role) throws Exception {
    for (String path : new String[] {"/api/me/context", "/api/me/menu?cafeteriaId=" + OPEN})
      mvc.perform(get(path).with(as(STAFF.get(role))))
          .andExpect(status().isForbidden())
          .andExpect(jsonPath("$.sites").doesNotExist())
          .andExpect(jsonPath("$.categories").doesNotExist());
  }

  @Test
  void anonymousAndRejectedTokensAreUnauthorized() throws Exception {
    mvc.perform(get("/api/me/context")).andExpect(status().isUnauthorized());
    mvc.perform(get("/api/me/menu").queryParam("cafeteriaId", OPEN.toString()))
        .andExpect(status().isUnauthorized());
    mvc.perform(get("/api/me/context").header("Authorization", "Bearer forged"))
        .andExpect(status().isUnauthorized());
  }

  @Test
  void clientWithoutProfileAndInvalidCafeteriaIdAreSafeErrors() throws Exception {
    mvc.perform(get("/api/me/context").with(as(NO_PROFILE)))
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.code").value("CLIENT_PROFILE_NOT_FOUND"));
    mvc.perform(get("/api/me/menu").with(as(STUDENT)).queryParam("cafeteriaId", "not-a-uuid"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("Selecciona una cafetería válida."));
    mvc.perform(get("/api/me/menu").with(as(STUDENT))).andExpect(status().isBadRequest());
  }
}

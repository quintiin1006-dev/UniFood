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
import com.santotofood.adapter.in.web.ClientDailyMenuController;
import com.santotofood.adapter.in.web.error.ClientCatalogExceptionHandler;
import com.santotofood.adapter.in.web.error.GlobalExceptionHandler;
import com.santotofood.adapter.out.persistence.AuthorizationPersistenceAdapter;
import com.santotofood.adapter.out.persistence.ClientCatalogPersistenceAdapter;
import com.santotofood.adapter.out.persistence.DailyMenuPersistenceAdapter;
import com.santotofood.adapter.out.time.SystemTimeProvider;
import com.santotofood.application.port.out.DailyMenuFlag;
import com.santotofood.application.service.ClientCatalogService;
import com.santotofood.application.service.ClientDailyMenuService;
import com.santotofood.domain.model.BusinessDate;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
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
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.jwt.BadJwtException;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.support.AnnotationConfigWebApplicationContext;
import org.springframework.web.servlet.config.annotation.EnableWebMvc;

/**
 * GET /api/me/daily-menu and the dailyMenu field of GET /api/me/menu on the real schema up to 031,
 * with this test's own fixture (never the staging seed).
 */
@Timeout(90)
class DailyMenuClientApiPostgresTest {
  static final AtomicBoolean FLAG = new AtomicBoolean(true);
  static final UUID STUDENT = UUID.randomUUID();
  static final UUID OTHER_STUDENT = UUID.randomUUID();
  static final UUID WORKER = UUID.randomUUID();
  static final UUID ADMIN = UUID.randomUUID();
  static final UUID SUPER_ADMIN = UUID.randomUUID();
  static final UUID OPEN = UUID.randomUUID();
  static final UUID CLOSED = UUID.randomUUID();
  static final UUID DRAFT = UUID.randomUUID();
  static final UUID INCOMPLETE = UUID.randomUUID();
  static final UUID NO_MENU = UUID.randomUUID();
  static final UUID INACTIVE = UUID.randomUUID();
  static final UUID FOREIGN = UUID.randomUUID();
  static UUID protein;
  static UUID sides;
  static UUID extras;
  static UUID egg;
  static Process database;
  static AnnotationConfigWebApplicationContext context;
  static JdbcTemplate jdbc;
  static MockMvc mvc;
  static DataSource dataSource;

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
    DailyMenuFlag dailyMenuFlag() {
      return FLAG::get;
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
        DailyMenuPersistenceAdapter.class,
        SystemTimeProvider.class,
        ClientCatalogService.class,
        ClientDailyMenuService.class,
        ClientCatalogController.class,
        ClientDailyMenuController.class,
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

  @BeforeEach
  void flagOn() {
    FLAG.set(true);
  }

  // ---- fixture -----------------------------------------------------------------------------

  static void user(UUID id, String email, String role) {
    jdbc.update("INSERT INTO auth.users(id,email) VALUES (?, ?)", id, email);
    jdbc.update(
        "INSERT INTO public.user_roles(user_id,role_id) SELECT ?,id FROM public.roles WHERE name::text=?",
        id,
        role);
  }

  static void student(UUID id, String email, String domain) {
    user(id, email, "CLIENT");
    jdbc.update(
        "INSERT INTO public.clients(user_id,full_name,document,institution_id,client_type,institutional_code) "
            + "SELECT ?,'Ana Torres',null,id,'STUDENT',? FROM public.institutions WHERE email_domain=?",
        id,
        String.valueOf(7000000 + Math.abs(id.hashCode() % 999999)),
        domain);
    jdbc.update("UPDATE public.users SET is_active=true WHERE id=?", id);
  }

  static void staff(UUID id, String role, UUID cafeteria) {
    user(id, id + "@example.invalid", role);
    if (cafeteria != null)
      jdbc.update(
          "INSERT INTO public.cafeteria_users(user_id,cafeteria_id) VALUES (?,?)", id, cafeteria);
    jdbc.update("UPDATE public.users SET is_active=true WHERE id=?", id);
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

  static void cafeteria(UUID id, UUID site, String name) {
    jdbc.update(
        "INSERT INTO public.cafeterias(id,site_id,name,is_active,lunch_order_start,lunch_order_end) VALUES (?,?,?,false,'06:00','18:00')",
        id,
        site,
        name);
  }

  /** 009: an active cafeteria needs its active ADMIN in the same transaction. */
  static void activate(UUID cafe) {
    UUID admin = UUID.randomUUID();
    jdbc.execute(
        (java.sql.Connection connection) -> {
          connection.setAutoCommit(false);
          var tx = new JdbcTemplate(new SingleConnectionDataSource(connection, true));
          tx.update(
              "INSERT INTO auth.users(id,email) VALUES (?, ?)", admin, admin + "@example.invalid");
          tx.update(
              "INSERT INTO public.user_roles(user_id,role_id) SELECT ?,id FROM public.roles WHERE name::text='ADMIN'",
              admin);
          tx.update(
              "INSERT INTO public.cafeteria_users(user_id,cafeteria_id) VALUES (?,?)", admin, cafe);
          tx.update("UPDATE public.users SET is_active=true WHERE id=?", admin);
          tx.update("UPDATE public.cafeterias SET is_active=true WHERE id=?", cafe);
          connection.commit();
          connection.setAutoCommit(true);
          return null;
        });
  }

  static UUID category(UUID cafe, String label, String kind, int position, boolean canSkip) {
    return jdbc.queryForObject(
        "INSERT INTO public.daily_menu_categories(cafeteria_id,label,kind,position,can_skip) VALUES (?,?,?,?,?) RETURNING id",
        UUID.class,
        cafe,
        label,
        kind,
        position,
        canSkip);
  }

  static void day(UUID cafe, LocalDate date, String title, int price, boolean published) {
    jdbc.update(
        "INSERT INTO public.daily_menu_days(cafeteria_id,business_date,title_snapshot,plate_price_snapshot,published_at,published_by) VALUES (?,?,?,?,?,?)",
        cafe,
        date,
        title,
        price,
        published ? java.sql.Timestamp.from(Instant.now()) : null,
        published ? WORKER : null);
  }

  static void option(UUID cafe, LocalDate date, UUID category, String label) {
    jdbc.update(
        "INSERT INTO public.daily_menu_options(cafeteria_id,business_date,category_id,label) VALUES (?,?,?,?)",
        cafe,
        date,
        category,
        label);
  }

  static UUID addition(UUID cafe, String name, int price, boolean active) {
    return jdbc.queryForObject(
        "INSERT INTO public.daily_menu_additions(cafeteria_id,name,extra_price,active) VALUES (?,?,?,?) RETURNING id",
        UUID.class,
        cafe,
        name,
        price,
        active);
  }

  static void switchOn(UUID cafe, LocalDate date, UUID addition, boolean on, int price) {
    jdbc.update(
        "INSERT INTO public.daily_menu_addition_availability(cafeteria_id,business_date,addition_id,is_available,extra_price) VALUES (?,?,?,?,?)",
        cafe,
        date,
        addition,
        on,
        price);
  }

  /** A published, complete menu: Proteína with one option, Acompañamientos skippable. */
  static void simpleMenu(UUID cafe, LocalDate date, String label) {
    var meat = category(cafe, "Proteína", "SINGLE", 0, false);
    day(cafe, date, "Almuerzo del día", 9500, true);
    option(cafe, date, meat, label);
  }

  static void seed() {
    var today = BusinessDate.from(Instant.now()).value();
    var yesterday = today.minusDays(1);
    jdbc.update(
        "INSERT INTO public.institutions(name,email_domain,brand_name) VALUES ('Otra universidad','other.example.invalid','Otra')");
    UUID main = site("ustavillavo.edu.co", "Sede Principal");
    UUID foreignSite = site("other.example.invalid", "Sede ajena");
    cafeteria(OPEN, main, "Cafetería Central");
    cafeteria(CLOSED, main, "Cafetería Norte");
    cafeteria(DRAFT, main, "Cafetería Borrador");
    cafeteria(INCOMPLETE, main, "Cafetería Incompleta");
    cafeteria(NO_MENU, main, "Cafetería Sin Menú");
    cafeteria(INACTIVE, main, "Cafetería Inactiva");
    cafeteria(FOREIGN, foreignSite, "Cafetería ajena");
    for (UUID cafe : new UUID[] {OPEN, CLOSED, DRAFT, INCOMPLETE, NO_MENU, FOREIGN}) activate(cafe);
    jdbc.update(
        "INSERT INTO public.cafeteria_daily_states(cafeteria_id,business_date,is_open) VALUES (?,?,true),(?,?,false)",
        OPEN,
        today,
        CLOSED,
        today);
    student(STUDENT, "ana@ustavillavo.edu.co", "ustavillavo.edu.co");
    student(OTHER_STUDENT, "otra@other.example.invalid", "other.example.invalid");
    staff(WORKER, "WORKER", OPEN);
    // 009: one ADMIN per cafeteria, so the denied ADMIN takes the inactive one.
    staff(ADMIN, "ADMIN", INACTIVE);
    staff(SUPER_ADMIN, "SUPER_ADMIN", null);

    // OPEN: the current settings differ from the published snapshot on purpose.
    jdbc.update(
        "INSERT INTO public.daily_menu_settings(cafeteria_id,title,plate_price) VALUES (?,'Título nuevo',12000)",
        OPEN);
    protein = category(OPEN, "Proteína", "SINGLE", 0, false);
    sides = category(OPEN, "Acompañamientos", "SINGLE", 1, true);
    extras = category(OPEN, "Adiciones", "ADDITIONS", 2, true);
    var retired = category(OPEN, "Sopa", "SINGLE", 3, false);
    jdbc.update("UPDATE public.daily_menu_categories SET active=false WHERE id=?", retired);
    egg = addition(OPEN, "Huevo frito", 2000, true);
    var cheese = addition(OPEN, "Queso", 1500, true);
    var plantain = addition(OPEN, "Tajada", 1000, true);
    // Yesterday: published with its own title, options and additions; it must not leak.
    day(OPEN, yesterday, "Plato de ayer", 8000, true);
    option(OPEN, yesterday, protein, "Cerdo de ayer");
    option(OPEN, yesterday, sides, "Ensalada de ayer");
    switchOn(OPEN, yesterday, cheese, true, 1500);
    // Today.
    day(OPEN, today, "Almuerzo del día", 9500, true);
    option(OPEN, today, protein, "Pollo a la plancha");
    option(OPEN, today, protein, "Res guisada");
    switchOn(OPEN, today, egg, true, 2500);
    switchOn(OPEN, today, cheese, false, 1500);
    switchOn(OPEN, today, plantain, true, 1000);
    // Switched on today, then retired from the catalog: never served.
    jdbc.update("UPDATE public.daily_menu_additions SET active=false WHERE id=?", plantain);

    simpleMenu(CLOSED, today, "Pescado");
    var draftMeat = category(DRAFT, "Proteína", "SINGLE", 0, false);
    day(DRAFT, today, null, 0, false);
    option(DRAFT, today, draftMeat, "Pollo en borrador");
    // Published, then the only mandatory option was removed: incomplete.
    category(INCOMPLETE, "Proteína", "SINGLE", 0, false);
    day(INCOMPLETE, today, "Almuerzo del día", 9500, true);
    simpleMenu(FOREIGN, today, "Plato ajeno");
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

  static org.springframework.test.web.servlet.ResultActions dailyMenu(UUID user, UUID cafeteria)
      throws Exception {
    return mvc.perform(
        get("/api/me/daily-menu").with(as(user)).queryParam("cafeteriaId", cafeteria.toString()));
  }

  // ---- GET /api/me/daily-menu --------------------------------------------------------------

  @Test
  void publishedMenuFollowsTheContractWithTodaysRowsOnly() throws Exception {
    dailyMenu(STUDENT, OPEN)
        .andExpect(status().isOk())
        .andExpect(header().string("Cache-Control", "no-store"))
        .andExpect(jsonPath("$.cafeteria.id").value(OPEN.toString()))
        .andExpect(jsonPath("$.cafeteria.name").value("Cafetería Central"))
        .andExpect(jsonPath("$.cafeteria.open").value(true))
        .andExpect(
            jsonPath("$.businessDate").value(BusinessDate.from(Instant.now()).value().toString()))
        .andExpect(jsonPath("$.title").value("Almuerzo del día"))
        .andExpect(jsonPath("$.price").value("9500.00"))
        .andExpect(
            jsonPath("$.categories[*].label", contains("Proteína", "Acompañamientos", "Adiciones")))
        .andExpect(jsonPath("$.categories[0].id").value(protein.toString()))
        .andExpect(jsonPath("$.categories[0].kind").value("SINGLE"))
        .andExpect(jsonPath("$.categories[0].canSkip").value(false))
        .andExpect(
            jsonPath(
                "$.categories[0].options[*].label", contains("Pollo a la plancha", "Res guisada")))
        .andExpect(jsonPath("$.categories[0].additions").doesNotExist())
        .andExpect(jsonPath("$.categories[1].id").value(sides.toString()))
        .andExpect(jsonPath("$.categories[1].canSkip").value(true))
        .andExpect(jsonPath("$.categories[1].options", hasSize(0)))
        .andExpect(jsonPath("$.categories[2].id").value(extras.toString()))
        .andExpect(jsonPath("$.categories[2].kind").value("ADDITIONS"))
        .andExpect(jsonPath("$.categories[2].options").doesNotExist())
        .andExpect(jsonPath("$.categories[2].additions", hasSize(1)))
        .andExpect(jsonPath("$.categories[2].additions[0].id").value(egg.toString()))
        .andExpect(jsonPath("$.categories[2].additions[0].name").value("Huevo frito"))
        // The day's copied price, not the catalog's 2000.
        .andExpect(jsonPath("$.categories[2].additions[0].extraPrice").value("2500.00"))
        .andExpect(content().string(not(containsString("ayer"))))
        .andExpect(content().string(not(containsString("Título nuevo"))))
        .andExpect(content().string(not(containsString("Queso"))))
        .andExpect(content().string(not(containsString("Tajada"))))
        .andExpect(content().string(not(containsString("Sopa"))))
        .andExpect(content().string(not(containsString("version"))))
        .andExpect(content().string(not(containsString("published"))))
        .andExpect(content().string(not(containsString(WORKER.toString()))));
  }

  @Test
  void closedCafeteriaServesItsMenuWithOpenFalse() throws Exception {
    dailyMenu(STUDENT, CLOSED)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.cafeteria.open").value(false))
        .andExpect(jsonPath("$.categories[0].options[0].label").value("Pescado"));
  }

  @Test
  void draftIncompleteAndMissingMenusAreNotPublished() throws Exception {
    for (UUID cafe : new UUID[] {DRAFT, INCOMPLETE, NO_MENU})
      dailyMenu(STUDENT, cafe)
          .andExpect(status().isNotFound())
          .andExpect(header().string("Cache-Control", "no-store"))
          .andExpect(jsonPath("$.code").value("DAILY_MENU_NOT_PUBLISHED"))
          .andExpect(jsonPath("$.message").value("Hoy todavía no hay menú del día publicado."))
          .andExpect(content().string(not(containsString("borrador"))));
  }

  @Test
  void visibilityMatchesTheCatalog() throws Exception {
    dailyMenu(STUDENT, FOREIGN)
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.code").value("CAFETERIA_NOT_FOUND"))
        .andExpect(content().string(not(containsString("Plato ajeno"))));
    dailyMenu(STUDENT, UUID.randomUUID())
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.code").value("CAFETERIA_NOT_FOUND"));
    dailyMenu(STUDENT, INACTIVE)
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.code").value("CAFETERIA_NOT_SUBSCRIBED"));
    // The foreign institution's own client reads it normally.
    dailyMenu(OTHER_STUDENT, FOREIGN)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.categories[0].options[0].label").value("Plato ajeno"));
  }

  @Test
  void flagOffIsDisabledBeforeVisibility() throws Exception {
    FLAG.set(false);
    for (UUID cafe : new UUID[] {OPEN, FOREIGN, INACTIVE, UUID.randomUUID()})
      dailyMenu(STUDENT, cafe)
          .andExpect(status().isNotFound())
          .andExpect(jsonPath("$.code").value("DAILY_MENU_DISABLED"))
          .andExpect(jsonPath("$.message").value("El menú del día no está disponible por ahora."));
  }

  @ParameterizedTest
  @ValueSource(strings = {"WORKER", "ADMIN", "SUPER_ADMIN"})
  void nonClientsAreDeniedEvenWithClientClaims(String role) throws Exception {
    var subject = Map.of("WORKER", WORKER, "ADMIN", ADMIN, "SUPER_ADMIN", SUPER_ADMIN).get(role);
    dailyMenu(subject, OPEN)
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.categories").doesNotExist());
  }

  @Test
  void anonymousAndRejectedTokensAreUnauthorized() throws Exception {
    mvc.perform(get("/api/me/daily-menu").queryParam("cafeteriaId", OPEN.toString()))
        .andExpect(status().isUnauthorized());
    mvc.perform(
            get("/api/me/daily-menu")
                .queryParam("cafeteriaId", OPEN.toString())
                .header("Authorization", "Bearer forged"))
        .andExpect(status().isUnauthorized());
  }

  @Test
  void invalidCafeteriaIdIsABadRequest() throws Exception {
    mvc.perform(get("/api/me/daily-menu").with(as(STUDENT)).queryParam("cafeteriaId", "nope"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("Selecciona una cafetería válida."));
  }

  // ---- GET /api/me/menu dailyMenu field ----------------------------------------------------

  @Test
  void menuReportsWhetherTodaysDailyMenuIsAvailable() throws Exception {
    for (var entry :
        Map.of(OPEN, true, CLOSED, true, DRAFT, false, INCOMPLETE, false, NO_MENU, false)
            .entrySet())
      mvc.perform(
              get("/api/me/menu")
                  .with(as(STUDENT))
                  .queryParam("cafeteriaId", entry.getKey().toString()))
          .andExpect(status().isOk())
          .andExpect(jsonPath("$.dailyMenu.available").value(entry.getValue()))
          .andExpect(jsonPath("$.dailyMenu.*", hasSize(1)));
  }

  @Test
  void withTheFlagOffTheMenuBodyIsExactlyTheCurrentOne() throws Exception {
    String on =
        mvc.perform(
                get("/api/me/menu").with(as(STUDENT)).queryParam("cafeteriaId", OPEN.toString()))
            .andExpect(status().isOk())
            .andReturn()
            .getResponse()
            .getContentAsString(StandardCharsets.UTF_8);
    FLAG.set(false);
    String off =
        mvc.perform(
                get("/api/me/menu").with(as(STUDENT)).queryParam("cafeteriaId", OPEN.toString()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.dailyMenu").doesNotExist())
            .andExpect(jsonPath("$.*", hasSize(3)))
            .andReturn()
            .getResponse()
            .getContentAsString(StandardCharsets.UTF_8);
    assertFalse(off.contains("dailyMenu"));
    assertEquals(off, on.replace(",\"dailyMenu\":{\"available\":true}", ""));
  }
}

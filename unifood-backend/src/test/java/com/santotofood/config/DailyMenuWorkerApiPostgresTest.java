package com.santotofood.config;

import static org.hamcrest.Matchers.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.santotofood.adapter.in.web.WorkerDailyMenuController;
import com.santotofood.adapter.in.web.error.GlobalExceptionHandler;
import com.santotofood.adapter.in.web.error.WorkerDailyMenuExceptionHandler;
import com.santotofood.adapter.out.persistence.AuthorizationPersistenceAdapter;
import com.santotofood.adapter.out.persistence.DailyMenuPersistenceAdapter;
import com.santotofood.adapter.out.time.SystemTimeProvider;
import com.santotofood.application.port.in.ManageWorkerDailyMenuUseCase;
import com.santotofood.application.port.out.DailyMenuFlag;
import com.santotofood.application.service.WorkerDailyMenuService;
import com.santotofood.domain.model.BusinessDate;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
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
import org.springframework.security.oauth2.jwt.BadJwtException;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.EnableTransactionManagement;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.context.support.AnnotationConfigWebApplicationContext;
import org.springframework.web.servlet.config.annotation.EnableWebMvc;

/**
 * /api/worker/daily-menu/today on the real schema up to 031, with real transactions and this test's
 * own fixture (never the staging seed).
 */
@Timeout(120)
class DailyMenuWorkerApiPostgresTest {
  static final String BASE = "/api/worker/daily-menu/today";
  static final AtomicBoolean FLAG = new AtomicBoolean(true);
  static final UUID MAIN = UUID.randomUUID();
  static final UUID OTHER = UUID.randomUUID();
  static final UUID WORKER = UUID.randomUUID();
  static final UUID OTHER_WORKER = UUID.randomUUID();
  static final UUID ADMIN = UUID.randomUUID();
  static UUID protein;
  static UUID starch;
  static UUID drink;
  static UUID egg;
  static UUID retired;
  static UUID otherProtein;
  static Process database;
  static AnnotationConfigWebApplicationContext context;
  static DataSource dataSource;
  static JdbcTemplate jdbc;
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
    JdbcTemplate jdbc(DataSource source) {
      return new JdbcTemplate(source);
    }

    @Bean
    PlatformTransactionManager transactions(DataSource source) {
      return new DataSourceTransactionManager(source);
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
        DailyMenuPersistenceAdapter.class,
        SystemTimeProvider.class,
        WorkerDailyMenuService.class,
        WorkerDailyMenuController.class,
        WorkerDailyMenuExceptionHandler.class,
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

  static LocalDate today() {
    return BusinessDate.from(Instant.now()).value();
  }

  /** Every test starts from an empty today and the original plate and catalog. */
  @BeforeEach
  void reset() {
    FLAG.set(true);
    var today = today();
    for (String table : List.of("daily_menu_options", "daily_menu_addition_availability"))
      jdbc.update("DELETE FROM public." + table + " WHERE business_date >= ?", today.minusDays(1));
    jdbc.update("DELETE FROM public.daily_menu_days WHERE business_date >= ?", today.minusDays(1));
    jdbc.update(
        "UPDATE public.daily_menu_settings SET title='Almuerzo del día', plate_price=9500 WHERE cafeteria_id=?",
        MAIN);
    jdbc.update("UPDATE public.daily_menu_additions SET extra_price=2000 WHERE id=?", egg);
  }

  // ---- fixture -----------------------------------------------------------------------------

  static void staff(UUID id, String role, UUID cafeteria) {
    jdbc.update("INSERT INTO auth.users(id,email) VALUES (?, ?)", id, id + "@example.invalid");
    jdbc.update(
        "INSERT INTO public.user_roles(user_id,role_id) SELECT ?,id FROM public.roles WHERE name::text=?",
        id,
        role);
    jdbc.update(
        "INSERT INTO public.cafeteria_users(user_id,cafeteria_id) VALUES (?,?)", id, cafeteria);
    jdbc.update("UPDATE public.users SET is_active=true WHERE id=?", id);
  }

  /** 009: an active cafeteria needs its active ADMIN in the same transaction. */
  static void activate(UUID cafe, UUID admin) {
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

  static UUID addition(UUID cafe, String name, int price, boolean active) {
    return jdbc.queryForObject(
        "INSERT INTO public.daily_menu_additions(cafeteria_id,name,extra_price,active) VALUES (?,?,?,?) RETURNING id",
        UUID.class,
        cafe,
        name,
        price,
        active);
  }

  static void seed() {
    UUID site = UUID.randomUUID();
    jdbc.update(
        "INSERT INTO public.sites(id,name,city,institution_id) SELECT ?,'Sede Principal','Villavicencio',id FROM public.institutions WHERE email_domain='ustavillavo.edu.co'",
        site);
    for (var cafe : List.of(List.of(MAIN, "Cafetería Central"), List.of(OTHER, "Cafetería Norte")))
      jdbc.update(
          "INSERT INTO public.cafeterias(id,site_id,name,is_active,lunch_order_start,lunch_order_end) VALUES (?,?,?,false,'06:00','18:00')",
          cafe.get(0),
          site,
          cafe.get(1));
    activate(MAIN, ADMIN);
    activate(OTHER, UUID.randomUUID());
    staff(WORKER, "WORKER", MAIN);
    staff(OTHER_WORKER, "WORKER", OTHER);
    jdbc.update(
        "INSERT INTO public.daily_menu_settings(cafeteria_id,title,plate_price) VALUES (?,'Almuerzo del día',9500)",
        MAIN);
    protein = category(MAIN, "Proteína", "SINGLE", 0, false);
    starch = category(MAIN, "Principio", "SINGLE", 1, false);
    drink = category(MAIN, "Bebida", "SINGLE", 2, true);
    category(MAIN, "Adiciones", "ADDITIONS", 3, true);
    var soup = category(MAIN, "Sopa", "SINGLE", 4, false);
    jdbc.update("UPDATE public.daily_menu_categories SET active=false WHERE id=?", soup);
    egg = addition(MAIN, "Huevo frito", 2000, true);
    retired = addition(MAIN, "Tajada", 1000, false);
    // OTHER has a template but no plate price.
    otherProtein = category(OTHER, "Proteína", "SINGLE", 0, false);
  }

  static ResultActions call(
      UUID worker,
      org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder request)
      throws Exception {
    return mvc.perform(
        request
            .contentType(MediaType.APPLICATION_JSON)
            .header("X-Business-Date", today().toString())
            .with(
                jwt()
                    .jwt(
                        token ->
                            token
                                .subject(worker.toString())
                                .claim("user_metadata", Map.of("role", "WORKER")))));
  }

  static ResultActions options(UUID worker, UUID category, long version, String json)
      throws Exception {
    return call(
        worker,
        put(BASE + "/categories/" + category + "/options")
            .content("{\"expectedVersion\":" + version + ",\"options\":" + json + "}"));
  }

  static ResultActions action(UUID worker, String path, long version) throws Exception {
    return call(worker, post(BASE + path).content("{\"expectedVersion\":" + version + "}"));
  }

  static ResultActions switchAddition(UUID addition, long version, boolean on) throws Exception {
    return call(
        WORKER,
        put(BASE + "/additions/" + addition)
            .content("{\"expectedVersion\":" + version + ",\"available\":" + on + "}"));
  }

  static int count(String sql, Object... args) {
    return jdbc.queryForObject(sql, Integer.class, args);
  }

  // ---- tests -------------------------------------------------------------------------------

  @Test
  void emptyDayFollowsTheContract() throws Exception {
    call(WORKER, get(BASE))
        .andExpect(status().isOk())
        .andExpect(header().string("Cache-Control", "no-store"))
        .andExpect(jsonPath("$.businessDate").value(today().toString()))
        .andExpect(jsonPath("$.version").value(0))
        .andExpect(jsonPath("$.published").value(false))
        .andExpect(jsonPath("$.complete").value(false))
        .andExpect(jsonPath("$.missingCategories", contains("Proteína", "Principio")))
        .andExpect(jsonPath("$.priceSet").value(true))
        .andExpect(jsonPath("$.title").value("Almuerzo del día"))
        .andExpect(jsonPath("$.price").value("9500.00"))
        .andExpect(jsonPath("$.categories[*].label", contains("Proteína", "Principio", "Bebida")))
        .andExpect(jsonPath("$.categories[0].kind").value("SINGLE"))
        .andExpect(jsonPath("$.categories[0].textUsed").value(0))
        .andExpect(jsonPath("$.additions[*].name", contains("Huevo frito")))
        .andExpect(jsonPath("$.additions[0].extraPrice").value("2000.00"))
        .andExpect(jsonPath("$.additions[0].available").value(false))
        .andExpect(jsonPath("$.skippedCategories").doesNotExist())
        .andExpect(content().string(not(containsString("Sopa"))))
        .andExpect(content().string(not(containsString("Tajada"))));
    // A read never creates the day.
    assertEquals(
        0, count("SELECT count(*) FROM public.daily_menu_days WHERE cafeteria_id=?", MAIN));
  }

  @Test
  void optionsAreNormalizedInOrderAndInvalidOnesChangeNothing() throws Exception {
    options(WORKER, protein, 0, "[\"  Pollo   a la plancha \",\"Res\"]")
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.version").value(1))
        .andExpect(
            jsonPath("$.categories[0].options[*].label", contains("Pollo a la plancha", "Res")))
        .andExpect(jsonPath("$.categories[0].textUsed").value(21));
    options(WORKER, protein, 1, "[\"Arroz, frijol\"]")
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("DAILY_MENU_OPTION_INVALID"));
    options(WORKER, protein, 1, "[\"Res\",\" res \"]")
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("DAILY_MENU_OPTION_DUPLICATED"));
    options(WORKER, protein, 1, "[\"" + "a".repeat(200) + "\",\"" + "b".repeat(151) + "\"]")
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("DAILY_MENU_TEXT_TOO_LONG"));
    var many = new StringBuilder("[");
    for (int i = 0; i < 21; i++) many.append(i == 0 ? "" : ",").append("\"o").append(i).append('"');
    options(WORKER, protein, 1, many.append(']').toString())
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("DAILY_MENU_OPTION_INVALID"));
    // Exactly 350 characters fits the 031 trigger too.
    options(WORKER, starch, 1, "[\"" + "a".repeat(175) + "\",\"" + "b".repeat(175) + "\"]")
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.categories[1].textUsed").value(350));
    call(WORKER, get(BASE))
        .andExpect(jsonPath("$.version").value(2))
        .andExpect(
            jsonPath("$.categories[0].options[*].label", contains("Pollo a la plancha", "Res")));
  }

  @Test
  void staleVersionAndAnotherDayAreConflicts() throws Exception {
    options(WORKER, protein, 0, "[\"Pollo\"]").andExpect(status().isOk());
    options(WORKER, protein, 0, "[\"Res\"]")
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.code").value("DAILY_MENU_VERSION_CONFLICT"));
    mvc.perform(
            put(BASE + "/categories/" + protein + "/options")
                .contentType(MediaType.APPLICATION_JSON)
                .header("X-Business-Date", today().minusDays(1).toString())
                .content("{\"expectedVersion\":1,\"options\":[\"Res\"]}")
                .with(jwt().jwt(token -> token.subject(WORKER.toString()))))
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.code").value("DAILY_MENU_DATE_CHANGED"));
    call(WORKER, get(BASE))
        .andExpect(jsonPath("$.version").value(1))
        .andExpect(jsonPath("$.categories[0].options[*].label", contains("Pollo")));
  }

  @Test
  void publishFreezesTitleAndPriceAndUnpublishHidesIt() throws Exception {
    options(WORKER, protein, 0, "[\"Pollo\"]");
    action(WORKER, "/publish", 1)
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.code").value("DAILY_MENU_INCOMPLETE"))
        .andExpect(jsonPath("$.missingCategories", contains("Principio")));
    options(WORKER, starch, 1, "[\"Arroz\"]");
    action(WORKER, "/publish", 2)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.published").value(true))
        .andExpect(jsonPath("$.complete").value(true))
        .andExpect(jsonPath("$.version").value(3));
    assertEquals(
        WORKER + "|Almuerzo del día|9500.00",
        jdbc.queryForObject(
            "SELECT published_by||'|'||title_snapshot||'|'||plate_price_snapshot FROM public.daily_menu_days WHERE cafeteria_id=? AND business_date=?",
            String.class,
            MAIN,
            today()));
    // The admin changes the plate: today's published copy does not move.
    jdbc.update(
        "UPDATE public.daily_menu_settings SET title='Plato nuevo', plate_price=12000 WHERE cafeteria_id=?",
        MAIN);
    call(WORKER, get(BASE)).andExpect(jsonPath("$.price").value("9500.00"));
    action(WORKER, "/unpublish", 3)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.published").value(false))
        .andExpect(jsonPath("$.title").value("Plato nuevo"));
    assertEquals(
        0,
        count(
            "SELECT count(*) FROM public.daily_menu_days WHERE cafeteria_id=? AND published_at IS NOT NULL",
            MAIN));
    action(WORKER, "/publish", 4)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.price").value("12000.00"));
  }

  @Test
  void withoutPlatePriceNothingIsPublished() throws Exception {
    options(OTHER_WORKER, otherProtein, 0, "[\"Pollo\"]").andExpect(status().isOk());
    call(OTHER_WORKER, get(BASE))
        .andExpect(jsonPath("$.priceSet").value(false))
        .andExpect(jsonPath("$.price").value(nullValue()));
    action(OTHER_WORKER, "/publish", 1)
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.code").value("DAILY_MENU_PRICE_NOT_SET"));
  }

  @Test
  void additionsFreezeTheirPriceWhenSwitchedOn() throws Exception {
    switchAddition(egg, 0, true)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.additions[0].available").value(true));
    jdbc.update("UPDATE public.daily_menu_additions SET extra_price=3000 WHERE id=?", egg);
    call(WORKER, get(BASE)).andExpect(jsonPath("$.additions[0].extraPrice").value("2000.00"));
    switchAddition(egg, 1, false).andExpect(jsonPath("$.additions[0].available").value(false));
    switchAddition(egg, 2, true).andExpect(jsonPath("$.additions[0].extraPrice").value("3000.00"));
    switchAddition(retired, 3, true)
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.code").value("DAILY_MENU_ADDITION_UNAVAILABLE"));
  }

  @Test
  void copyYesterdayCopiesIngredientsOnlyIntoEmptyCategories() throws Exception {
    var yesterday = today().minusDays(1);
    jdbc.update(
        "INSERT INTO public.daily_menu_days(cafeteria_id,business_date) VALUES (?,?)",
        MAIN,
        yesterday);
    for (var row :
        List.of(
            List.of(protein, "Cerdo"),
            List.of(starch, "Lentejas"),
            List.of(starch, "Arroz"),
            List.of(drink, "Limonada")))
      jdbc.update(
          "INSERT INTO public.daily_menu_options(cafeteria_id,business_date,category_id,label,created_at) VALUES (?,?,?,?,clock_timestamp())",
          MAIN,
          yesterday,
          row.get(0),
          row.get(1));
    jdbc.update(
        "INSERT INTO public.daily_menu_addition_availability(cafeteria_id,business_date,addition_id,is_available,extra_price) VALUES (?,?,?,true,2000)",
        MAIN,
        yesterday,
        egg);
    options(WORKER, protein, 0, "[\"Pollo\"]");
    action(WORKER, "/copy-yesterday", 1)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.skippedCategories", contains("Proteína")))
        .andExpect(jsonPath("$.categories[0].options[*].label", contains("Pollo")))
        .andExpect(jsonPath("$.categories[1].options[*].label", contains("Lentejas", "Arroz")))
        .andExpect(jsonPath("$.categories[2].options[*].label", contains("Limonada")))
        .andExpect(jsonPath("$.additions[0].available").value(false))
        .andExpect(jsonPath("$.published").value(false));
    // Yesterday is untouched.
    assertEquals(
        4,
        count(
            "SELECT count(*) FROM public.daily_menu_options WHERE cafeteria_id=? AND business_date=?",
            MAIN,
            yesterday));
  }

  @Test
  void aWorkerOnlyReachesTheirOwnCafeteria() throws Exception {
    options(OTHER_WORKER, protein, 0, "[\"Intruso\"]")
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.code").value("DAILY_MENU_CATEGORY_NOT_FOUND"));
    call(
            OTHER_WORKER,
            put(BASE + "/additions/" + egg).content("{\"expectedVersion\":0,\"available\":true}"))
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.code").value("DAILY_MENU_ADDITION_UNAVAILABLE"));
    call(ADMIN, get(BASE))
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.code").value("DAILY_MENU_FORBIDDEN"));
    assertEquals(
        0,
        count(
            "SELECT count(*) FROM public.daily_menu_options WHERE cafeteria_id=? AND business_date=?",
            MAIN,
            today()));
  }

  @Test
  void flagOffAnswersDisabledEverywhere() throws Exception {
    FLAG.set(false);
    call(WORKER, get(BASE))
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.code").value("DAILY_MENU_DISABLED"));
    options(WORKER, protein, 0, "[\"Pollo\"]")
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.code").value("DAILY_MENU_DISABLED"));
    action(WORKER, "/publish", 0).andExpect(jsonPath("$.code").value("DAILY_MENU_DISABLED"));
    assertEquals(
        0, count("SELECT count(*) FROM public.daily_menu_days WHERE cafeteria_id=?", MAIN));
  }

  @Test
  void twoWritesWithTheSameVersionSerializeAndTheSecondIsAConflict() throws Exception {
    var service = context.getBean(ManageWorkerDailyMenuUseCase.class);
    var transactions = new TransactionTemplate(context.getBean(PlatformTransactionManager.class));
    var holding = new CountDownLatch(1);
    var release = new CountDownLatch(1);
    try (var executor = Executors.newFixedThreadPool(2)) {
      var first =
          executor.submit(
              () ->
                  transactions.execute(
                      status -> {
                        service.replaceOptions(MAIN, today(), 0, protein, List.of("Pollo"));
                        holding.countDown();
                        try {
                          assertTrue(release.await(30, TimeUnit.SECONDS));
                        } catch (InterruptedException interrupted) {
                          throw new IllegalStateException(interrupted);
                        }
                        return null;
                      }));
      assertTrue(holding.await(30, TimeUnit.SECONDS));
      var second =
          executor.submit(
              () ->
                  options(WORKER, protein, 0, "[\"Res\"]")
                      .andReturn()
                      .getResponse()
                      .getContentAsString());
      // The second request waits on the day header lock before the first one commits.
      long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(20);
      while (count(
              "SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%daily_menu_days%'")
          == 0) {
        assertTrue(System.nanoTime() < deadline, "The second write never waited on the lock");
        Thread.sleep(50);
      }
      release.countDown();
      first.get(30, TimeUnit.SECONDS);
      assertTrue(second.get(30, TimeUnit.SECONDS).contains("DAILY_MENU_VERSION_CONFLICT"));
    }
    call(WORKER, get(BASE))
        .andExpect(jsonPath("$.version").value(1))
        .andExpect(jsonPath("$.categories[0].options[*].label", contains("Pollo")));
  }

  static List<String> ids(UUID category) {
    return jdbc.queryForList(
        "SELECT id::text FROM public.daily_menu_options WHERE cafeteria_id=? AND business_date=? AND category_id=? ORDER BY created_at, id",
        String.class,
        MAIN,
        today(),
        category);
  }

  @Test
  void reorderingKeepsTheIdsAndChangesTheOrder() throws Exception {
    options(WORKER, protein, 0, "[\"Pollo\",\"Res\",\"Cerdo\"]").andExpect(status().isOk());
    var before = ids(protein);
    options(WORKER, protein, 1, "[\"Cerdo\",\" pollo \",\"Res\"]")
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.categories[0].options[*].label", contains("Cerdo", "pollo", "Res")));
    // Same three ids, now in the new order; «pollo» kept the id of «Pollo».
    assertEquals(List.of(before.get(2), before.get(0), before.get(1)), ids(protein));
    // Removing one keeps the others; a new one gets a new id.
    options(WORKER, protein, 2, "[\"Res\",\"Pescado\"]").andExpect(status().isOk());
    var after = ids(protein);
    assertEquals(before.get(1), after.get(0));
    assertFalse(before.contains(after.get(1)));
  }
}

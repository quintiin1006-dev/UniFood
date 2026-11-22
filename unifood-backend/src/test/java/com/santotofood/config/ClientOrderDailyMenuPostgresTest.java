package com.santotofood.config;

import static org.hamcrest.Matchers.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.santotofood.adapter.in.web.ClientOrderController;
import com.santotofood.adapter.in.web.error.ClientOrderExceptionHandler;
import com.santotofood.adapter.in.web.error.GlobalExceptionHandler;
import com.santotofood.adapter.in.web.mapper.OrderResponseMapper;
import com.santotofood.adapter.out.persistence.AuthorizationPersistenceAdapter;
import com.santotofood.adapter.out.persistence.ClientOrderPersistenceAdapter;
import com.santotofood.adapter.out.persistence.DailyMenuPersistenceAdapter;
import com.santotofood.application.port.in.CancelOrderUseCase;
import com.santotofood.application.port.in.GetOwnCurrentOrderUseCase;
import com.santotofood.application.port.in.GetOwnOrderHistoryUseCase;
import com.santotofood.application.port.in.GetOwnOrderUseCase;
import com.santotofood.application.port.in.ManageWorkerDailyMenuUseCase;
import com.santotofood.application.port.out.DailyMenuFlag;
import com.santotofood.application.port.out.OrderDailyMenuQueryPort;
import com.santotofood.application.service.ClientOrderCreationService;
import com.santotofood.application.service.WorkerDailyMenuService;
import com.santotofood.domain.model.BusinessDate;
import com.santotofood.domain.port.out.TimeProvider;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
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
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.jwt.BadJwtException;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.EnableTransactionManagement;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.context.support.AnnotationConfigWebApplicationContext;
import org.springframework.web.servlet.config.annotation.EnableWebMvc;

/**
 * POST /api/me/orders with a daily menu on the real schema up to 031: total, copy, idempotency,
 * rejections and a race against a worker write. Own fixture, never the staging seed.
 */
@Timeout(150)
class ClientOrderDailyMenuPostgresTest {
  static final Instant NOW = Instant.now();
  static final AtomicBoolean FLAG = new AtomicBoolean(true);
  static final AtomicInteger CODES = new AtomicInteger(830000);
  static final UUID CAFE = UUID.randomUUID();
  static final UUID JUICE = UUID.randomUUID();
  static final UUID WORKER = UUID.randomUUID();
  static UUID protein;
  static UUID starch;
  static UUID drink;
  static UUID egg;
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
    PlatformTransactionManager transactionManager(DataSource source) {
      return new DataSourceTransactionManager(source);
    }

    @Bean
    TimeProvider clock() {
      return () -> NOW;
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

    @Bean
    CancelOrderUseCase cancel() {
      return mock(CancelOrderUseCase.class);
    }

    @Bean
    GetOwnOrderUseCase detail() {
      return mock(GetOwnOrderUseCase.class);
    }

    @Bean
    GetOwnCurrentOrderUseCase current() {
      return mock(GetOwnCurrentOrderUseCase.class);
    }

    @Bean
    GetOwnOrderHistoryUseCase history() {
      return mock(GetOwnOrderHistoryUseCase.class);
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
        ClientOrderPersistenceAdapter.class,
        DailyMenuPersistenceAdapter.class,
        ClientOrderCreationService.class,
        WorkerDailyMenuService.class,
        OrderResponseMapper.class,
        ClientOrderController.class,
        ClientOrderExceptionHandler.class,
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
    return BusinessDate.from(NOW).value();
  }

  static ManageWorkerDailyMenuUseCase worker() {
    return context.getBean(ManageWorkerDailyMenuUseCase.class);
  }

  static long version() {
    return jdbc.queryForObject(
        "SELECT version FROM public.daily_menu_days WHERE cafeteria_id=? AND business_date=?",
        Long.class,
        CAFE,
        today());
  }

  /**
   * Every test starts from today's menu published and complete, written by the real worker path.
   */
  @BeforeEach
  void publishedMenu() {
    FLAG.set(true);
    jdbc.update(
        "DELETE FROM public.daily_menu_options WHERE cafeteria_id=? AND business_date=?",
        CAFE,
        today());
    jdbc.update(
        "DELETE FROM public.daily_menu_addition_availability WHERE cafeteria_id=? AND business_date=?",
        CAFE,
        today());
    // Days referenced by an order copy stay: order_daily_menus has no FK to them.
    jdbc.update(
        "DELETE FROM public.daily_menu_days WHERE cafeteria_id=? AND business_date=?",
        CAFE,
        today());
    jdbc.update("UPDATE public.daily_menu_additions SET extra_price=2500 WHERE id=?", egg);
    var menus = worker();
    menus.replaceOptions(CAFE, today(), 0, protein, List.of("Pollo a la plancha", "Res"));
    menus.replaceOptions(CAFE, today(), 1, starch, List.of("Arroz", "Lentejas"));
    menus.replaceOptions(CAFE, today(), 2, drink, List.of("Limonada"));
    menus.setAddition(CAFE, today(), 3, egg, true);
    // The catalog changes after switching on: the order pays the frozen 2500.
    jdbc.update("UPDATE public.daily_menu_additions SET extra_price=3000 WHERE id=?", egg);
    menus.publish(CAFE, WORKER, today(), 4);
  }

  // ---- fixture -----------------------------------------------------------------------------

  static void seed() {
    UUID site = UUID.randomUUID();
    jdbc.update(
        "INSERT INTO public.sites(id,name,city,institution_id) SELECT ?,'Sede Principal','Villavicencio',id FROM public.institutions WHERE email_domain='ustavillavo.edu.co'",
        site);
    jdbc.update(
        "INSERT INTO public.cafeterias(id,site_id,name,is_active,lunch_order_start,lunch_order_end) VALUES (?,?,'Cafetería Central',false,'00:00','23:59')",
        CAFE,
        site);
    UUID admin = UUID.randomUUID();
    jdbc.execute(
        (Connection connection) -> {
          connection.setAutoCommit(false);
          var tx = new JdbcTemplate(new SingleConnectionDataSource(connection, true));
          tx.update(
              "INSERT INTO auth.users(id,email) VALUES (?, ?)", admin, admin + "@example.invalid");
          tx.update(
              "INSERT INTO public.user_roles(user_id,role_id) SELECT ?,id FROM public.roles WHERE name::text='ADMIN'",
              admin);
          tx.update(
              "INSERT INTO public.cafeteria_users(user_id,cafeteria_id) VALUES (?,?)", admin, CAFE);
          tx.update("UPDATE public.users SET is_active=true WHERE id=?", admin);
          tx.update("UPDATE public.cafeterias SET is_active=true WHERE id=?", CAFE);
          connection.commit();
          connection.setAutoCommit(true);
          return null;
        });
    jdbc.update(
        "INSERT INTO auth.users(id,email) VALUES (?, ?)", WORKER, WORKER + "@example.invalid");
    jdbc.update(
        "INSERT INTO public.user_roles(user_id,role_id) SELECT ?,id FROM public.roles WHERE name::text='WORKER'",
        WORKER);
    jdbc.update(
        "INSERT INTO public.cafeteria_users(user_id,cafeteria_id) VALUES (?,?)", WORKER, CAFE);
    jdbc.update("UPDATE public.users SET is_active=true WHERE id=?", WORKER);
    jdbc.update(
        "INSERT INTO public.cafeteria_daily_states(cafeteria_id,business_date,is_open) VALUES (?,?,true)",
        CAFE,
        today());
    jdbc.update(
        "INSERT INTO public.lunches(id,cafeteria_id,name,price,category) VALUES (?,?,'Jugo natural',4500,'BEBIDA')",
        JUICE,
        CAFE);
    jdbc.update(
        "INSERT INTO public.daily_item_availability(cafeteria_id,item_id,business_date,is_available) VALUES (?,?,?,true)",
        CAFE,
        JUICE,
        today());
    jdbc.update(
        "INSERT INTO public.daily_menu_settings(cafeteria_id,title,plate_price) VALUES (?,'Almuerzo del día',9500)",
        CAFE);
    protein = category("Proteína", "SINGLE", 0, false);
    starch = category("Principio", "SINGLE", 1, false);
    drink = category("Bebida", "SINGLE", 2, true);
    category("Adiciones", "ADDITIONS", 3, true);
    egg =
        jdbc.queryForObject(
            "INSERT INTO public.daily_menu_additions(cafeteria_id,name,extra_price) VALUES (?,'Huevo frito',2500) RETURNING id",
            UUID.class,
            CAFE);
  }

  static UUID category(String label, String kind, int position, boolean canSkip) {
    return jdbc.queryForObject(
        "INSERT INTO public.daily_menu_categories(cafeteria_id,label,kind,position,can_skip) VALUES (?,?,?,?,?) RETURNING id",
        UUID.class,
        CAFE,
        label,
        kind,
        position,
        canSkip);
  }

  /** A fresh active STUDENT, so each order starts without an active one. */
  static UUID client() {
    UUID id = UUID.randomUUID();
    jdbc.update("INSERT INTO auth.users(id,email) VALUES (?, ?)", id, id + "@ustavillavo.edu.co");
    jdbc.update(
        "INSERT INTO public.clients(user_id,full_name,institution_id,client_type,institutional_code) "
            + "SELECT ?,'Ana Torres',id,'STUDENT',? FROM public.institutions WHERE email_domain='ustavillavo.edu.co'",
        id,
        String.valueOf(CODES.incrementAndGet()));
    jdbc.update(
        "INSERT INTO public.user_roles(user_id,role_id) SELECT ?,id FROM public.roles WHERE name::text='CLIENT'",
        id);
    jdbc.update("UPDATE public.users SET is_active=true WHERE id=?", id);
    return id;
  }

  static UUID option(UUID category, String label) {
    return jdbc.queryForObject(
        "SELECT id FROM public.daily_menu_options WHERE cafeteria_id=? AND business_date=? AND category_id=? AND label=?",
        UUID.class,
        CAFE,
        today(),
        category,
        label);
  }

  /** A plate: chosen Proteína and Principio, «Ninguna» in Bebida, and the given additions. */
  static String menu(LocalDate date, UUID chosenProtein, UUID chosenStarch, UUID... additions) {
    var ids = new ArrayList<String>();
    for (UUID addition : additions) ids.add("\"" + addition + "\"");
    return "{\"businessDate\":\""
        + date
        + "\",\"choices\":[{\"categoryId\":\""
        + protein
        + "\",\"optionId\":\""
        + chosenProtein
        + "\"},{\"categoryId\":\""
        + starch
        + "\",\"optionId\":\""
        + chosenStarch
        + "\"},{\"categoryId\":\""
        + drink
        + "\",\"skip\":true}],\"additionIds\":["
        + String.join(",", ids)
        + "]}";
  }

  static String body(String items, String menu) {
    return "{\"cafeteriaId\":\""
        + CAFE
        + "\",\"items\":"
        + items
        + (menu == null ? "" : ",\"dailyMenu\":" + menu)
        // Prices or totals from the browser are ignored.
        + ",\"total\":\"1.00\"}";
  }

  static String plate(UUID... additions) {
    return menu(today(), option(protein, "Pollo a la plancha"), option(starch, "Arroz"), additions);
  }

  static ResultActions order(UUID user, String key, String body) throws Exception {
    return mvc.perform(
        post("/api/me/orders")
            .contentType(MediaType.APPLICATION_JSON)
            .content(body)
            .header("Idempotency-Key", key)
            .with(
                jwt()
                    .jwt(token -> token.subject(user.toString()).claim("role", "CLIENT"))
                    .authorities(new SimpleGrantedAuthority("ROLE_CLIENT"))));
  }

  static String key() {
    return "key-" + UUID.randomUUID();
  }

  static String id(MvcResult result) throws Exception {
    var json = result.getResponse().getContentAsString();
    var start = json.indexOf("\"id\":\"") + 6;
    return json.substring(start, json.indexOf('"', start));
  }

  static int count(String sql, Object... args) {
    return jdbc.queryForObject(sql, Integer.class, args);
  }

  static int orders(UUID user) {
    return count(
        "SELECT count(*) FROM public.orders o JOIN public.clients c ON c.id=o.client_id WHERE c.user_id=?",
        user);
  }

  // ---- tests -------------------------------------------------------------------------------

  @Test
  void totalIsComputedOnTheServerAndTheChoiceIsCopied() throws Exception {
    var user = client();
    var result =
        order(user, key(), body("[{\"productId\":\"" + JUICE + "\",\"quantity\":1}]", plate(egg)))
            .andExpect(status().isCreated())
            // 4500 + 9500 + 2500 (the price when switched on, not the catalog's 3000).
            .andExpect(jsonPath("$.total").value("16500.00"))
            .andExpect(jsonPath("$.items", hasSize(1)))
            .andExpect(jsonPath("$.dailyMenu.title").value("Almuerzo del día"))
            .andExpect(jsonPath("$.dailyMenu.price").value("9500.00"))
            .andExpect(
                jsonPath(
                    "$.dailyMenu.choices[*].category",
                    contains("Proteína", "Principio", "Bebida", "Adiciones")))
            .andExpect(
                jsonPath(
                    "$.dailyMenu.choices[*].kind",
                    contains("OPTION", "OPTION", "NONE", "ADDITION")))
            .andExpect(jsonPath("$.dailyMenu.choices[0].label").value("Pollo a la plancha"))
            .andExpect(jsonPath("$.dailyMenu.choices[2].label").value(nullValue()))
            .andExpect(jsonPath("$.dailyMenu.choices[3].extraPrice").value("2500.00"))
            .andReturn();
    var orderId = UUID.fromString(id(result));
    assertEquals(
        "Almuerzo del día|9500.00|" + today(),
        jdbc.queryForObject(
            "SELECT title_snapshot||'|'||plate_price||'|'||business_date FROM public.order_daily_menus WHERE order_id=?",
            String.class,
            orderId));
    assertEquals(
        4, count("SELECT count(*) FROM public.order_daily_menu_choices WHERE order_id=?", orderId));
    assertEquals(1, count("SELECT count(*) FROM public.order_items WHERE order_id=?", orderId));
  }

  @Test
  void aPlateAloneIsAnOrderButAnEmptyOrderIsNot() throws Exception {
    var user = client();
    order(user, key(), body("[]", plate()))
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.total").value("9500.00"))
        .andExpect(jsonPath("$.items", hasSize(0)));
    var other = client();
    order(other, key(), body("[]", null))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("INVALID_ORDER_REQUEST"));
    assertEquals(0, orders(other));
  }

  @Test
  void anOrderWithoutMenuAnswersExactlyAsBefore() throws Exception {
    order(client(), key(), body("[{\"productId\":\"" + JUICE + "\",\"quantity\":1}]", null))
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.total").value("4500.00"))
        .andExpect(jsonPath("$.dailyMenu").doesNotExist());
  }

  @Test
  void theCopyNeverChangesAndRepeatingTheKeyIsIdempotent() throws Exception {
    var user = client();
    var key = key();
    var body = body("[]", plate(egg));
    var first = id(order(user, key, body).andExpect(status().isCreated()).andReturn());
    // The worker removes the chosen protein and switches the addition off.
    worker().replaceOptions(CAFE, today(), version(), protein, List.of("Res"));
    worker().setAddition(CAFE, today(), version(), egg, false);
    order(user, key, body)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.id").value(first))
        .andExpect(jsonPath("$.dailyMenu.choices[0].label").value("Pollo a la plancha"))
        .andExpect(jsonPath("$.dailyMenu.choices[3].extraPrice").value("2500.00"));
    // Same key, another menu: a conflict, never a second order.
    order(user, key, body("[]", menu(today(), option(protein, "Res"), option(starch, "Arroz"))))
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.code").value("IDEMPOTENCY_KEY_CONFLICT"));
    assertEquals(1, orders(user));
  }

  @Test
  void editingOrReorderingOneCategoryKeepsTheChoicesOfAnother() throws Exception {
    var chicken = option(protein, "Pollo a la plancha");
    var rice = option(starch, "Arroz");
    // The client's screen holds these ids while the worker edits.
    worker().replaceOptions(CAFE, today(), version(), starch, List.of("Lentejas", "Arroz", "Papa"));
    worker()
        .replaceOptions(CAFE, today(), version(), protein, List.of("Res", "Pollo a la plancha"));
    order(client(), key(), body("[]", menu(today(), chicken, rice)))
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.dailyMenu.choices[0].label").value("Pollo a la plancha"))
        .andExpect(jsonPath("$.dailyMenu.choices[1].label").value("Arroz"));
  }

  @Test
  void refusedMenusCreateNothing() throws Exception {
    var user = client();
    order(
            user,
            key(),
            body("[]", menu(today().minusDays(1), option(protein, "Res"), option(starch, "Arroz"))))
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.code").value("DAILY_MENU_DATE_CHANGED"));
    order(user, key(), body("[]", menu(today(), option(starch, "Arroz"), option(starch, "Arroz"))))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("DAILY_MENU_SELECTION_INVALID"));
    order(user, key(), body("[]", plate(UUID.randomUUID())))
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.code").value("DAILY_MENU_ADDITION_UNAVAILABLE"));
    FLAG.set(false);
    order(user, key(), body("[]", plate()))
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.code").value("DAILY_MENU_DISABLED"));
    FLAG.set(true);
    var body = body("[]", plate());
    worker().unpublish(CAFE, today(), version());
    order(user, key(), body)
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.code").value("DAILY_MENU_NOT_PUBLISHED"));
    // Published again but emptied: incomplete is the same refusal.
    worker().publish(CAFE, WORKER, today(), version());
    worker().replaceOptions(CAFE, today(), version(), starch, List.of());
    order(user, key(), body)
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.code").value("DAILY_MENU_NOT_PUBLISHED"));
    assertEquals(0, orders(user));
  }

  @Test
  void anOrderWaitsForAWorkerWriteAndSeesItsResult() throws Exception {
    var user = client();
    var body = body("[]", plate());
    var transactions = new TransactionTemplate(context.getBean(PlatformTransactionManager.class));
    var holding = new CountDownLatch(1);
    var release = new CountDownLatch(1);
    try (var executor = Executors.newFixedThreadPool(2)) {
      var unpublish =
          executor.submit(
              () ->
                  transactions.execute(
                      status -> {
                        worker().unpublish(CAFE, today(), version());
                        holding.countDown();
                        try {
                          assertTrue(release.await(30, TimeUnit.SECONDS));
                        } catch (InterruptedException interrupted) {
                          throw new IllegalStateException(interrupted);
                        }
                        return null;
                      }));
      assertTrue(holding.await(30, TimeUnit.SECONDS));
      var placed =
          executor.submit(
              () -> order(user, key(), body).andReturn().getResponse().getContentAsString());
      // The order waits on the day header (FOR SHARE) while the worker holds FOR UPDATE.
      long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(20);
      while (count(
              "SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%daily_menu_days%'")
          == 0) {
        assertTrue(System.nanoTime() < deadline, "The order never waited on the day header");
        Thread.sleep(50);
      }
      release.countDown();
      unpublish.get(30, TimeUnit.SECONDS);
      // It saw the committed, unpublished menu: never half of it.
      assertTrue(placed.get(30, TimeUnit.SECONDS).contains("DAILY_MENU_NOT_PUBLISHED"));
    }
    assertEquals(0, orders(user));
  }

  @Test
  void theCopiesOfSeveralOrdersAreReadInOneCall() throws Exception {
    var first = UUID.fromString(id(order(client(), key(), body("[]", plate())).andReturn()));
    var second =
        UUID.fromString(
            id(
                order(
                        client(),
                        key(),
                        body("[{\"productId\":\"" + JUICE + "\",\"quantity\":1}]", null))
                    .andReturn()));
    var menus =
        context.getBean(OrderDailyMenuQueryPort.class).findDailyMenus(List.of(first, second));
    assertEquals(1, menus.size());
    assertEquals(3, menus.get(first).choices().size());
    assertEquals(
        Map.of(), context.getBean(OrderDailyMenuQueryPort.class).findDailyMenus(List.of()));
  }
}

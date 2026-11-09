package com.santotofood.config;

import static org.hamcrest.Matchers.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;
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
import com.santotofood.adapter.out.time.SystemTimeProvider;
import com.santotofood.application.port.in.CancelOrderUseCase;
import com.santotofood.application.service.ClientOrderCreationService;
import com.santotofood.domain.model.BusinessDate;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import javax.sql.DataSource;
import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
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
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.web.context.support.AnnotationConfigWebApplicationContext;
import org.springframework.web.servlet.config.annotation.EnableWebMvc;

/**
 * B15 create order: HTTP guards, use case, JDBC and the 020 unique indexes on the real 001-021
 * schema. The races run two real requests that the test holds behind a cafeteria lock, so both pass
 * every read before either inserts and only the database can decide.
 */
@Timeout(120)
class ClientOrderCreationApiPostgresTest {
  static final UUID OPEN = UUID.randomUUID();
  static final UUID CLOSED = UUID.randomUUID();
  static final UUID INACTIVE = UUID.randomUUID();
  static final UUID FOREIGN = UUID.randomUUID();
  static final UUID JUICE = UUID.randomUUID();
  static final UUID LUNCH = UUID.randomUUID();
  static final UUID NOT_MARKED = UUID.randomUUID();
  static final UUID MARKED_OFF = UUID.randomUUID();
  static final UUID RETIRED = UUID.randomUUID();
  static final UUID TRAP = UUID.randomUUID();
  static final UUID CLOSED_PRODUCT = UUID.randomUUID();
  static final UUID FOREIGN_PRODUCT = UUID.randomUUID();
  static final UUID NO_PROFILE = UUID.randomUUID();
  static final Map<String, UUID> STAFF =
      Map.of(
          "WORKER",
          UUID.randomUUID(),
          "ADMIN",
          UUID.randomUUID(),
          "SUPER_ADMIN",
          UUID.randomUUID());
  static final AtomicInteger CODES = new AtomicInteger(1000000);
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
    PlatformTransactionManager transactionManager(DataSource source) {
      return new DataSourceTransactionManager(source);
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
        SystemTimeProvider.class,
        ClientOrderCreationService.class,
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

  // ---------------------------------------------------------------- fixture

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
  static void activate(UUID cafeteria) {
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
              "INSERT INTO public.cafeteria_users(user_id,cafeteria_id) VALUES (?,?)",
              admin,
              cafeteria);
          tx.update("UPDATE public.users SET is_active=true WHERE id=?", admin);
          tx.update("UPDATE public.cafeterias SET is_active=true WHERE id=?", cafeteria);
          connection.commit();
          connection.setAutoCommit(true);
          return null;
        });
  }

  static void product(UUID id, UUID cafeteria, String name, String category, int price) {
    jdbc.update(
        "INSERT INTO public.lunches(id,cafeteria_id,name,price,category) VALUES (?,?,?,?,?::public.catalog_category)",
        id,
        cafeteria,
        name,
        price,
        category);
  }

  static void mark(UUID cafeteria, UUID item, boolean available) {
    jdbc.update(
        "INSERT INTO public.daily_item_availability(cafeteria_id,item_id,business_date,is_available) VALUES (?,?,?,?)",
        cafeteria,
        item,
        today(),
        available);
  }

  static void openToday(UUID cafeteria, boolean open) {
    jdbc.update(
        "INSERT INTO public.cafeteria_daily_states(cafeteria_id,business_date,is_open) VALUES (?,?,?)",
        cafeteria,
        today(),
        open);
  }

  static java.time.LocalDate today() {
    return BusinessDate.from(Instant.now()).value();
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

  /** A fresh active STUDENT with a document, so each test starts without an active order. */
  static UUID client() {
    UUID id = UUID.randomUUID();
    jdbc.update("INSERT INTO auth.users(id,email) VALUES (?, ?)", id, id + "@ustavillavo.edu.co");
    jdbc.update(
        "INSERT INTO public.clients(user_id,full_name,document,institution_id,client_type,institutional_code) "
            + "SELECT ?,'Ana Torres',?,id,'STUDENT',? FROM public.institutions WHERE email_domain='ustavillavo.edu.co'",
        id,
        // clients.document is varchar(30).
        "DOC-PRIVATE-" + CODES.get(),
        String.valueOf(CODES.incrementAndGet()));
    jdbc.update(
        "INSERT INTO public.user_roles(user_id,role_id) SELECT ?,id FROM public.roles WHERE name::text='CLIENT'",
        id);
    jdbc.update("UPDATE public.users SET is_active=true WHERE id=?", id);
    return id;
  }

  static void seed() {
    jdbc.update(
        "INSERT INTO public.institutions(name,email_domain,brand_name) VALUES ('Otra universidad','other.example.invalid','Otra')");
    UUID main = site("ustavillavo.edu.co", "Sede Principal");
    UUID foreignSite = site("other.example.invalid", "Sede ajena");
    cafeteria(OPEN, main, "Cafetería Central");
    cafeteria(CLOSED, main, "Cafetería Norte");
    cafeteria(INACTIVE, main, "Cafetería Inactiva");
    cafeteria(FOREIGN, foreignSite, "Cafetería ajena");
    for (UUID cafe : new UUID[] {OPEN, CLOSED, FOREIGN}) activate(cafe);

    product(JUICE, OPEN, "Jugo natural", "BEBIDA", 4500);
    product(LUNCH, OPEN, "Corriente del día", "CORRIENTE", 13000);
    product(NOT_MARKED, OPEN, "Sin marcar hoy", "EJECUTIVO", 19000);
    product(MARKED_OFF, OPEN, "Agotado hoy", "ESPECIAL", 21000);
    product(RETIRED, OPEN, "Plato retirado", "DESAYUNO", 9500);
    product(TRAP, OPEN, "Producto trampa", "BEBIDA", 1000);
    product(CLOSED_PRODUCT, CLOSED, "Calentado con huevo", "DESAYUNO", 9500);
    product(FOREIGN_PRODUCT, FOREIGN, "Plato ajeno", "CORRIENTE", 11000);
    product(UUID.randomUUID(), INACTIVE, "Plato inactivo", "CORRIENTE", 11000);
    openToday(OPEN, true);
    openToday(CLOSED, false);
    openToday(FOREIGN, true);
    for (UUID item : new UUID[] {JUICE, LUNCH, RETIRED, TRAP}) mark(OPEN, item, true);
    mark(OPEN, MARKED_OFF, false);
    mark(CLOSED, CLOSED_PRODUCT, true);
    mark(FOREIGN, FOREIGN_PRODUCT, true);
    // Marked available before it was retired: still not orderable.
    jdbc.update("UPDATE public.lunches SET is_active=false WHERE id=?", RETIRED);

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

    // Atomicity probe: the order row is written, then its item fails and must take it along.
    jdbc.execute(
        "CREATE FUNCTION public.test_fail_trap_item() RETURNS trigger LANGUAGE plpgsql AS $$ "
            + "BEGIN IF NEW.lunch_name = 'Producto trampa' THEN "
            + "RAISE EXCEPTION 'forced item failure'; END IF; RETURN NEW; END $$");
    jdbc.execute(
        "CREATE TRIGGER trg_test_fail_trap_item BEFORE INSERT ON public.order_items "
            + "FOR EACH ROW EXECUTE FUNCTION public.test_fail_trap_item()");
  }

  // ---------------------------------------------------------------- helpers

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

  static String key() {
    return "key-" + UUID.randomUUID();
  }

  static String body(UUID cafeteria, String note, Object... lines) {
    var items = new ArrayList<String>();
    for (int i = 0; i < lines.length; i += 2)
      items.add("{\"productId\":\"" + lines[i] + "\",\"quantity\":" + lines[i + 1] + "}");
    return "{\"cafeteriaId\":\""
        + cafeteria
        + "\",\"note\":"
        + (note == null ? "null" : "\"" + note + "\"")
        + ",\"items\":["
        + String.join(",", items)
        + "]}";
  }

  static ResultActions order(UUID user, String key, String body) throws Exception {
    var request = post("/api/me/orders").contentType(MediaType.APPLICATION_JSON).content(body);
    if (user != null) request.with(as(user));
    if (key != null) request.header("Idempotency-Key", key);
    return mvc.perform(request);
  }

  static String id(MvcResult result) throws Exception {
    var json = result.getResponse().getContentAsString();
    var start = json.indexOf("\"id\":\"") + 6;
    return json.substring(start, json.indexOf('"', start));
  }

  static int orders(UUID user) {
    return jdbc.queryForObject(
        "SELECT count(*) FROM public.orders o JOIN public.clients c ON c.id=o.client_id WHERE c.user_id=?",
        Integer.class,
        user);
  }

  static int items(UUID user) {
    return jdbc.queryForObject(
        "SELECT count(*) FROM public.order_items i JOIN public.orders o ON o.id=i.order_id "
            + "JOIN public.clients c ON c.id=o.client_id WHERE c.user_id=?",
        Integer.class,
        user);
  }

  static void expectError(ResultActions result, int status, String code) throws Exception {
    result
        .andExpect(status().is(status))
        .andExpect(header().string("Cache-Control", "no-store"))
        .andExpect(jsonPath("$.status").value(status))
        .andExpect(jsonPath("$.code").value(code))
        .andExpect(jsonPath("$.message").isString())
        .andExpect(jsonPath("$.path").value("/api/me/orders"));
  }

  /**
   * Runs both requests while the test holds the cafeteria row, waits until both really block on it,
   * past every read, and then lets them race to the insert.
   */
  static List<MvcResult> race(Callable<MvcResult> first, Callable<MvcResult> second)
      throws Exception {
    var pool = Executors.newFixedThreadPool(2);
    try (Connection holder = dataSource.getConnection()) {
      holder.setAutoCommit(false);
      try (var lock =
          holder.prepareStatement("SELECT 1 FROM public.cafeterias WHERE id=? FOR UPDATE")) {
        lock.setObject(1, OPEN);
        lock.executeQuery();
      }
      List<Future<MvcResult>> results = List.of(pool.submit(first), pool.submit(second));
      long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(20);
      while (blockedOnCafeteria() < 2) {
        assertTrue(System.nanoTime() < deadline, "Both requests should wait on the cafeteria lock");
        Thread.sleep(20);
      }
      holder.commit();
      var done = new ArrayList<MvcResult>();
      for (var result : results) done.add(result.get(30, TimeUnit.SECONDS));
      return done;
    } finally {
      pool.shutdownNow();
    }
  }

  static int blockedOnCafeteria() {
    return jdbc.queryForObject(
        "SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock' "
            + "AND query LIKE '%FROM public.cafeterias c%FOR SHARE OF c%'",
        Integer.class);
  }

  // ---------------------------------------------------------------- creation

  @Test
  void createsAPendingOrderWithServerPricesAndTheClientsSnapshot() throws Exception {
    UUID user = client();
    String key = key();
    var result =
        order(user, key, body(OPEN, "  Sin cebolla  ", JUICE, 2, LUNCH, 1))
            .andExpect(status().isCreated())
            .andExpect(header().string("Cache-Control", "no-store"))
            .andExpect(jsonPath("$.status").value("PENDING"))
            .andExpect(jsonPath("$.total").value("22000.00"))
            .andExpect(jsonPath("$.note").value("Sin cebolla"))
            .andExpect(jsonPath("$.createdAt").isString())
            .andExpect(jsonPath("$.items", hasSize(2)))
            .andExpect(jsonPath("$.items[*].name", contains("Corriente del día", "Jugo natural")))
            .andExpect(jsonPath("$.items[1].quantity").value(2))
            .andExpect(jsonPath("$.items[1].unitPrice").value("4500.00"))
            .andExpect(jsonPath("$.items[1].subtotal").value("9000.00"))
            .andExpect(jsonPath("$.*", hasSize(6)))
            .andExpect(content().string(not(containsString("DOC-PRIVATE"))))
            .andReturn();

    var row =
        jdbc.queryForMap(
            "SELECT o.status::text AS status, o.total, o.note, o.client_name, o.client_document, "
                + "o.client_code, o.client_type::text AS client_type, o.idempotency_key, "
                + "o.request_hash, o.cafeteria_id, c.institutional_code "
                + "FROM public.orders o JOIN public.clients c ON c.id=o.client_id WHERE o.id=?::uuid",
            id(result));
    assertEquals("PENDING", row.get("status"));
    assertEquals(
        0, new java.math.BigDecimal("22000").compareTo((java.math.BigDecimal) row.get("total")));
    assertEquals("Sin cebolla", row.get("note"));
    assertEquals("Ana Torres", row.get("client_name"));
    assertNull(row.get("client_document"));
    assertEquals(row.get("institutional_code"), row.get("client_code"));
    assertEquals("STUDENT", row.get("client_type"));
    assertEquals(key, row.get("idempotency_key"));
    assertTrue(((String) row.get("request_hash")).matches("[0-9a-f]{64}"));
    assertEquals(OPEN, row.get("cafeteria_id"));
    assertEquals(2, items(user));
  }

  @Test
  void pricesAndTotalsInTheBodyAreIgnored() throws Exception {
    UUID user = client();
    String forged =
        "{\"cafeteriaId\":\""
            + OPEN
            + "\",\"total\":\"0.01\",\"price\":1,\"status\":\"DELIVERED\","
            + "\"clientCode\":\"9999999\",\"items\":[{\"productId\":\""
            + JUICE
            + "\",\"quantity\":2,\"unitPrice\":\"0.01\",\"price\":\"0.01\",\"subtotal\":\"0.02\","
            + "\"name\":\"Gratis\"}]}";
    order(user, key(), forged)
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.status").value("PENDING"))
        .andExpect(jsonPath("$.total").value("9000.00"))
        .andExpect(jsonPath("$.items[0].name").value("Jugo natural"))
        .andExpect(jsonPath("$.items[0].unitPrice").value("4500.00"));
    assertEquals(
        0,
        jdbc.queryForObject(
            "SELECT count(*) FROM public.orders WHERE client_code='9999999' OR total < 1",
            Integer.class));
  }

  @Test
  void blankNoteIsStoredAsNull() throws Exception {
    UUID user = client();
    var result =
        order(user, key(), body(OPEN, "   ", JUICE, 1))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.note").value(nullValue()))
            .andReturn();
    assertNull(
        jdbc.queryForObject(
            "SELECT note FROM public.orders WHERE id=?::uuid", String.class, id(result)));
  }

  // ---------------------------------------------------------------- idempotency

  @Test
  void anIdenticalRepeatReturnsTheSameOrderWith200() throws Exception {
    UUID user = client();
    String key = key();
    var created =
        order(user, key, body(OPEN, "Sin hielo", JUICE, 1))
            .andExpect(status().isCreated())
            .andReturn();
    order(user, key, body(OPEN, "Sin hielo", JUICE, 1))
        .andExpect(status().isOk())
        .andExpect(header().string("Cache-Control", "no-store"))
        .andExpect(jsonPath("$.id").value(id(created)))
        .andExpect(jsonPath("$.total").value("4500.00"))
        .andExpect(jsonPath("$.items", hasSize(1)));
    assertEquals(1, orders(user));
  }

  @Test
  void itemsInAnotherOrderAndAPaddedOrMissingNoteAreTheSameRequest() throws Exception {
    UUID user = client();
    String key = key();
    var created =
        order(user, key, body(OPEN, null, JUICE, 2, LUNCH, 1))
            .andExpect(status().isCreated())
            .andReturn();
    order(user, key, body(OPEN, "  ", LUNCH, 1, JUICE, 2))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.id").value(id(created)));
    order(
            user,
            key,
            "{\"cafeteriaId\":\""
                + OPEN
                + "\",\"items\":[{\"productId\":\""
                + LUNCH
                + "\",\"quantity\":1},{\"productId\":\""
                + JUICE
                + "\",\"quantity\":2}],\"note\":\"\"}")
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.id").value(id(created)));
    assertEquals(1, orders(user));
  }

  @Test
  void theSameKeyWithAnotherBodyIsAConflict() throws Exception {
    UUID user = client();
    String key = key();
    order(user, key, body(OPEN, "Sin cebolla", JUICE, 1)).andExpect(status().isCreated());
    expectError(
        order(user, key, body(OPEN, "Con cebolla", JUICE, 1)), 409, "IDEMPOTENCY_KEY_CONFLICT");
    expectError(
        order(user, key, body(OPEN, "Sin cebolla", JUICE, 2)), 409, "IDEMPOTENCY_KEY_CONFLICT");
    expectError(
        order(user, key, body(OPEN, "Sin cebolla", LUNCH, 1)), 409, "IDEMPOTENCY_KEY_CONFLICT");
    assertEquals(1, orders(user));
  }

  @Test
  void aRepeatReturnsTheOrdersCurrentStateEvenAfterItEndedOrTheCafeteriaClosed() throws Exception {
    UUID user = client();
    String key = key();
    var created =
        order(user, key, body(OPEN, null, JUICE, 1)).andExpect(status().isCreated()).andReturn();
    jdbc.update(
        "UPDATE public.orders SET status='DELIVERED', delivered_at=now() WHERE id=?::uuid",
        id(created));
    order(user, key, body(OPEN, null, JUICE, 1))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.id").value(id(created)))
        .andExpect(jsonPath("$.status").value("DELIVERED"));
    // A new key is a new order now that the first one ended.
    order(user, key(), body(OPEN, null, JUICE, 1)).andExpect(status().isCreated());
    assertEquals(2, orders(user));
  }

  @Test
  void anotherClientCanUseTheSameKey() throws Exception {
    String key = key();
    var first =
        order(client(), key, body(OPEN, null, JUICE, 1))
            .andExpect(status().isCreated())
            .andReturn();
    var second =
        order(client(), key, body(OPEN, null, JUICE, 1))
            .andExpect(status().isCreated())
            .andReturn();
    assertNotEquals(id(first), id(second));
  }

  @Test
  void twoConcurrentRequestsWithTheSameKeyCreateOneOrder() throws Exception {
    UUID user = client();
    String key = key();
    String body = body(OPEN, null, JUICE, 1);
    var results =
        race(() -> order(user, key, body).andReturn(), () -> order(user, key, body).andReturn());
    var statuses = results.stream().map(r -> r.getResponse().getStatus()).sorted().toList();
    assertEquals(List.of(200, 201), statuses);
    assertEquals(id(results.get(0)), id(results.get(1)));
    assertEquals(1, orders(user));
    assertEquals(1, items(user));
  }

  @Test
  void twoConcurrentRequestsWithDifferentKeysLeaveOneOrderAndOneActiveOrderConflict()
      throws Exception {
    UUID user = client();
    var results =
        race(
            () -> order(user, key(), body(OPEN, null, JUICE, 1)).andReturn(),
            () -> order(user, key(), body(OPEN, null, LUNCH, 1)).andReturn());
    var created = results.stream().filter(r -> r.getResponse().getStatus() == 201).toList();
    var refused = results.stream().filter(r -> r.getResponse().getStatus() == 409).toList();
    assertEquals(1, created.size());
    assertEquals(1, refused.size());
    var conflict = refused.getFirst().getResponse().getContentAsString();
    assertTrue(conflict.contains("\"code\":\"ACTIVE_ORDER_EXISTS\""), conflict);
    assertTrue(conflict.contains("\"activeOrderId\":\"" + id(created.getFirst()) + "\""), conflict);
    assertEquals(1, orders(user));
  }

  // ---------------------------------------------------------------- active order

  @Test
  void aSecondOrderWhileOneIsActiveIsRefusedWithItsId() throws Exception {
    UUID user = client();
    var first =
        order(user, key(), body(OPEN, null, JUICE, 1)).andExpect(status().isCreated()).andReturn();
    for (String state : new String[] {"PENDING", "PREPARING", "READY", "CALLED"}) {
      if (!state.equals("PENDING"))
        jdbc.update(
            "UPDATE public.orders SET status=?::public.order_status"
                + (state.equals("CALLED") ? ", called_at=now()" : "")
                + " WHERE id=?::uuid",
            state,
            id(first));
      var refused = order(user, key(), body(OPEN, null, LUNCH, 1));
      expectError(refused, 409, "ACTIVE_ORDER_EXISTS");
      refused.andExpect(jsonPath("$.activeOrderId").value(id(first)));
    }
    assertEquals(1, orders(user));
  }

  @Test
  void otherErrorsDoNotCarryAnActiveOrderId() throws Exception {
    order(client(), key(), body(CLOSED, null, CLOSED_PRODUCT, 1))
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.activeOrderId").doesNotExist());
  }

  // ---------------------------------------------------------------- limits and shape

  @Test
  void tenUnitsPerProductAndFifteenInTotalAreAllowed() throws Exception {
    order(client(), key(), body(OPEN, null, JUICE, 10, LUNCH, 5))
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.total").value("110000.00"));
  }

  @Test
  void moreThanTenUnitsOfOneProductOrFifteenInTotalAreRefused() throws Exception {
    UUID user = client();
    expectError(order(user, key(), body(OPEN, null, JUICE, 11)), 400, "ORDER_LIMIT_EXCEEDED");
    expectError(
        order(user, key(), body(OPEN, null, JUICE, 10, LUNCH, 6)), 400, "ORDER_LIMIT_EXCEEDED");
    assertEquals(0, orders(user));
  }

  @Test
  void aNoteOverTwoHundredCharactersIsRefused() throws Exception {
    UUID user = client();
    expectError(
        order(user, key(), body(OPEN, "a".repeat(201), JUICE, 1)), 400, "ORDER_NOTE_TOO_LONG");
    order(user, key(), body(OPEN, "ñ".repeat(200), JUICE, 1)).andExpect(status().isCreated());
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "",
        "{",
        "[]",
        "{\"cafeteriaId\":\"OPEN\",\"items\":[]}",
        "{\"cafeteriaId\":\"OPEN\"}",
        "{\"cafeteriaId\":\"not-a-uuid\",\"items\":[{\"productId\":\"JUICE\",\"quantity\":1}]}",
        "{\"items\":[{\"productId\":\"JUICE\",\"quantity\":1}]}",
        "{\"cafeteriaId\":\"OPEN\",\"items\":[{\"productId\":\"JUICE\",\"quantity\":0}]}",
        "{\"cafeteriaId\":\"OPEN\",\"items\":[{\"productId\":\"JUICE\",\"quantity\":-1}]}",
        "{\"cafeteriaId\":\"OPEN\",\"items\":[{\"productId\":\"JUICE\",\"quantity\":1.5}]}",
        "{\"cafeteriaId\":\"OPEN\",\"items\":[{\"productId\":\"JUICE\",\"quantity\":\"1\"}]}",
        "{\"cafeteriaId\":\"OPEN\",\"items\":[{\"productId\":\"JUICE\"}]}",
        "{\"cafeteriaId\":\"OPEN\",\"items\":[{\"quantity\":1}]}",
        "{\"cafeteriaId\":\"OPEN\",\"note\":5,\"items\":[{\"productId\":\"JUICE\",\"quantity\":1}]}",
        "{\"cafeteriaId\":\"OPEN\",\"items\":[{\"productId\":\"JUICE\",\"quantity\":1},{\"productId\":\"JUICE\",\"quantity\":1}]}",
        "{\"cafeteriaId\":\"OPEN\",\"cafeteriaId\":\"OPEN\",\"items\":[{\"productId\":\"JUICE\",\"quantity\":1}]}"
      })
  void malformedBodiesAndRepeatedProductsAreInvalid(String template) throws Exception {
    UUID user = client();
    String body = template.replace("OPEN", OPEN.toString()).replace("JUICE", JUICE.toString());
    expectError(order(user, key(), body), 400, "INVALID_ORDER_REQUEST");
    assertEquals(0, orders(user));
  }

  @ParameterizedTest
  @ValueSource(strings = {"", "short-key", "has spaces in the key!!", "ñandú-0123456789abc"})
  void aMissingOrMalformedIdempotencyKeyIsInvalid(String key) throws Exception {
    UUID user = client();
    expectError(
        order(user, key.isEmpty() ? null : key, body(OPEN, null, JUICE, 1)),
        400,
        "INVALID_ORDER_REQUEST");
    expectError(
        order(user, "k".repeat(129), body(OPEN, null, JUICE, 1)), 400, "INVALID_ORDER_REQUEST");
    assertEquals(0, orders(user));
  }

  @Test
  void aNonJsonContentTypeIsInvalid() throws Exception {
    UUID user = client();
    expectError(
        mvc.perform(
            post("/api/me/orders")
                .with(as(user))
                .header("Idempotency-Key", key())
                .contentType(MediaType.TEXT_PLAIN)
                .content(body(OPEN, null, JUICE, 1))),
        400,
        "INVALID_ORDER_REQUEST");
  }

  // ---------------------------------------------------------------- cafeteria and products

  @Test
  void aClosedCafeteriaRefusesOrders() throws Exception {
    UUID user = client();
    expectError(order(user, key(), body(CLOSED, null, CLOSED_PRODUCT, 1)), 409, "CAFETERIA_CLOSED");
    assertEquals(0, orders(user));
  }

  @Test
  void aCafeteriaWithoutTodaysStateIsClosed() throws Exception {
    UUID cafe = UUID.randomUUID();
    UUID item = UUID.randomUUID();
    cafeteria(
        cafe,
        jdbc.queryForObject("SELECT site_id FROM public.cafeterias WHERE id=?", UUID.class, OPEN),
        "Cafetería Sur");
    activate(cafe);
    product(item, cafe, "Arepa", "DESAYUNO", 3000);
    mark(cafe, item, true);
    expectError(order(client(), key(), body(cafe, null, item, 1)), 409, "CAFETERIA_CLOSED");
  }

  @Test
  void anInactiveCafeteriaIsNotSubscribed() throws Exception {
    UUID item =
        jdbc.queryForObject(
            "SELECT id FROM public.lunches WHERE cafeteria_id=?", UUID.class, INACTIVE);
    expectError(
        order(client(), key(), body(INACTIVE, null, item, 1)), 403, "CAFETERIA_NOT_SUBSCRIBED");
  }

  @Test
  void anotherInstitutionsCafeteriaLooksLikeAMissingOne() throws Exception {
    UUID user = client();
    var foreign =
        order(user, key(), body(FOREIGN, null, FOREIGN_PRODUCT, 1)).andReturn().getResponse();
    var missing =
        order(user, key(), body(UUID.randomUUID(), null, JUICE, 1)).andReturn().getResponse();
    assertEquals(404, foreign.getStatus());
    assertEquals(404, missing.getStatus());
    assertTrue(foreign.getContentAsString().contains("\"code\":\"CAFETERIA_NOT_FOUND\""));
    assertEquals(message(foreign.getContentAsString()), message(missing.getContentAsString()));
    assertFalse(foreign.getContentAsString().contains("ajena"));
    assertEquals(0, orders(user));
  }

  static String message(String json) {
    var start = json.indexOf("\"message\":\"") + 11;
    return json.substring(start, json.indexOf('"', start));
  }

  @Test
  void productsThatAreNotOrderableTodayAreUnavailable() throws Exception {
    UUID user = client();
    for (UUID product :
        new UUID[] {
          NOT_MARKED, MARKED_OFF, RETIRED, CLOSED_PRODUCT, FOREIGN_PRODUCT, UUID.randomUUID()
        }) {
      var refused = order(user, key(), body(OPEN, null, JUICE, 1, product, 1));
      expectError(refused, 409, "PRODUCT_UNAVAILABLE");
      refused.andExpect(content().string(not(containsString(product.toString()))));
    }
    assertEquals(0, orders(user));
  }

  // ---------------------------------------------------------------- atomicity

  @Test
  void aFailureAfterTheOrderRowLeavesNeitherOrderNorItems() throws Exception {
    UUID user = client();
    order(user, key(), body(OPEN, null, JUICE, 1, TRAP, 1)).andExpect(status().is5xxServerError());
    assertEquals(0, orders(user));
    assertEquals(0, items(user));
    // Nothing half-written blocks the next attempt.
    order(user, key(), body(OPEN, null, JUICE, 1)).andExpect(status().isCreated());
    assertEquals(1, items(user));
  }

  // ---------------------------------------------------------------- authorization

  @Test
  void anonymousRequestsAreRejected() throws Exception {
    order(null, key(), body(OPEN, null, JUICE, 1)).andExpect(status().isUnauthorized());
    mvc.perform(
            post("/api/me/orders")
                .header("Authorization", "Bearer forged")
                .header("Idempotency-Key", key())
                .contentType(MediaType.APPLICATION_JSON)
                .content(body(OPEN, null, JUICE, 1)))
        .andExpect(status().isUnauthorized());
  }

  @ParameterizedTest
  @ValueSource(strings = {"WORKER", "ADMIN", "SUPER_ADMIN"})
  void staffCannotCreateClientOrders(String role) throws Exception {
    order(STAFF.get(role), key(), body(OPEN, null, JUICE, 1)).andExpect(status().isForbidden());
    assertEquals(
        0,
        jdbc.queryForObject(
            "SELECT count(*) FROM public.orders WHERE client_id IS NULL", Integer.class));
  }

  @Test
  void aClientWithoutAClientRowIsForbiddenBeforeAnyValidation() throws Exception {
    expectError(order(NO_PROFILE, "bad", "{"), 403, "FORBIDDEN");
    expectError(order(NO_PROFILE, key(), body(OPEN, null, JUICE, 1)), 403, "FORBIDDEN");
  }

  @Test
  void aDeactivatedClientIsForbidden() throws Exception {
    UUID user = client();
    jdbc.update("UPDATE public.users SET is_active=false WHERE id=?", user);
    order(user, "bad", "{").andExpect(status().isForbidden());
    order(user, key(), body(OPEN, null, JUICE, 1)).andExpect(status().isForbidden());
    assertEquals(0, orders(user));
  }
}

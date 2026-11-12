package com.santotofood.config;

import static org.hamcrest.Matchers.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.santotofood.adapter.in.web.ClientOrderController;
import com.santotofood.adapter.in.web.error.ClientOrderExceptionHandler;
import com.santotofood.adapter.in.web.error.GlobalExceptionHandler;
import com.santotofood.adapter.out.persistence.AuthorizationPersistenceAdapter;
import com.santotofood.adapter.out.persistence.ClientOrderPersistenceAdapter;
import com.santotofood.adapter.out.persistence.OrderItemPersistenceAdapter;
import com.santotofood.adapter.out.persistence.OrderPersistenceAdapter;
import com.santotofood.adapter.out.persistence.entity.OrderEntity;
import com.santotofood.adapter.out.persistence.entity.OrderItemEntity;
import com.santotofood.adapter.out.persistence.mapper.OrderItemMapper;
import com.santotofood.adapter.out.persistence.mapper.OrderMapper;
import com.santotofood.adapter.out.persistence.repository.SpringDataOrderItemRepository;
import com.santotofood.adapter.out.persistence.repository.SpringDataOrderRepository;
import com.santotofood.application.port.in.CancelOrderUseCase;
import com.santotofood.application.port.in.CreateOwnOrderUseCase;
import com.santotofood.application.service.ClientOrderQueryService;
import com.santotofood.application.service.OrderService;
import com.santotofood.domain.port.out.OrderItemRepository;
import com.santotofood.domain.port.out.OrderRepository;
import com.santotofood.domain.port.out.TimeProvider;
import jakarta.persistence.EntityManagerFactory;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.lang.reflect.Proxy;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import javax.sql.DataSource;
import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.io.ClassPathResource;
import org.springframework.data.jpa.repository.support.JpaRepositoryFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DelegatingDataSource;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;
import org.springframework.mock.web.MockServletContext;
import org.springframework.orm.jpa.JpaTransactionManager;
import org.springframework.orm.jpa.LocalContainerEntityManagerFactoryBean;
import org.springframework.orm.jpa.SharedEntityManagerCreator;
import org.springframework.orm.jpa.persistenceunit.PersistenceManagedTypes;
import org.springframework.orm.jpa.vendor.HibernateJpaVendorAdapter;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.jwt.BadJwtException;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.transaction.annotation.EnableTransactionManagement;
import org.springframework.web.context.support.AnnotationConfigWebApplicationContext;
import org.springframework.web.servlet.config.annotation.EnableWebMvc;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * B16 current order, history, detail and the existing cancellation: HTTP guards, use cases, JDBC
 * and JPA on the real 001-021 schema. Every prepared statement is recorded, so a 304 can be shown
 * not to read the order or its items.
 */
@Timeout(120)
class ClientOrderQueryApiPostgresTest {
  static final Instant NOW = Instant.parse("2026-11-20T17:00:00Z");
  static final UUID CAFE = UUID.randomUUID();
  static final UUID JUICE = UUID.randomUUID();
  static final UUID LUNCH = UUID.randomUUID();
  static final UUID AREPA = UUID.randomUUID();
  static final UUID WORKER = UUID.randomUUID();
  static final UUID ADMIN = UUID.randomUUID();
  static final UUID SUPER_ADMIN = UUID.randomUUID();
  static final UUID NO_PROFILE = UUID.randomUUID();
  static final AtomicInteger CODES = new AtomicInteger(2000000);
  static final JsonMapper JSON = JsonMapper.builder().build();
  static Process database;
  static Recording source;
  static JdbcTemplate jdbc;
  static AnnotationConfigWebApplicationContext context;
  static MockMvc mvc;

  /** Records every SQL text Spring prepares, in order. */
  static class Recording extends DelegatingDataSource {
    final List<String> sql = Collections.synchronizedList(new ArrayList<>());

    Recording(DataSource target) {
      super(target);
    }

    @Override
    public Connection getConnection() throws java.sql.SQLException {
      Connection connection = super.getConnection();
      return (Connection)
          Proxy.newProxyInstance(
              Connection.class.getClassLoader(),
              new Class<?>[] {Connection.class},
              (proxy, method, args) -> {
                if (method.getName().equals("prepareStatement") && args[0] instanceof String text)
                  sql.add(text);
                try {
                  return method.invoke(connection, args);
                } catch (java.lang.reflect.InvocationTargetException failure) {
                  throw failure.getCause();
                }
              });
    }
  }

  @Configuration
  @EnableWebMvc
  @EnableTransactionManagement
  static class TestConfig {
    @Bean
    DataSource dataSource() {
      return source;
    }

    @Bean
    JdbcTemplate jdbc(DataSource ds) {
      return new JdbcTemplate(ds);
    }

    @Bean
    TimeProvider clock() {
      return () -> NOW;
    }

    @Bean
    LocalContainerEntityManagerFactoryBean entityManagerFactory(DataSource ds) {
      var factory = new LocalContainerEntityManagerFactoryBean();
      factory.setDataSource(ds);
      factory.setJpaVendorAdapter(new HibernateJpaVendorAdapter());
      factory.setManagedTypes(
          PersistenceManagedTypes.of(OrderEntity.class.getName(), OrderItemEntity.class.getName()));
      factory.setJpaPropertyMap(Map.of("hibernate.hbm2ddl.auto", "none"));
      return factory;
    }

    @Bean
    JpaTransactionManager transactionManager(EntityManagerFactory factory) {
      return new JpaTransactionManager(factory);
    }

    @Bean
    JpaRepositoryFactory repositories(EntityManagerFactory factory) {
      return new JpaRepositoryFactory(
          SharedEntityManagerCreator.createSharedEntityManager(factory));
    }

    @Bean
    OrderRepository orderRepository(JpaRepositoryFactory repositories) {
      return new OrderPersistenceAdapter(
          repositories.getRepository(SpringDataOrderRepository.class), new OrderMapper());
    }

    @Bean
    OrderItemRepository orderItemRepository(JpaRepositoryFactory repositories) {
      return new OrderItemPersistenceAdapter(
          repositories.getRepository(SpringDataOrderItemRepository.class), new OrderItemMapper());
    }

    @Bean
    CancelOrderUseCase cancel(
        OrderRepository orders, OrderItemRepository items, TimeProvider clock) {
      return new OrderService(orders, items, clock);
    }

    @Bean
    CreateOwnOrderUseCase create() {
      return mock(CreateOwnOrderUseCase.class);
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
    var plain = new DriverManagerDataSource(url, "postgres", "");
    source = new Recording(plain);
    jdbc = new JdbcTemplate(plain);
    seed();
    context = new AnnotationConfigWebApplicationContext();
    context.setServletContext(new MockServletContext());
    context.register(
        TestConfig.class,
        SecurityConfig.class,
        OrderAuthorization.class,
        AuthorizationPersistenceAdapter.class,
        ClientOrderPersistenceAdapter.class,
        ClientOrderQueryService.class,
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

  static void seed() {
    UUID site = UUID.randomUUID();
    jdbc.update(
        "INSERT INTO public.sites(id,name,city,institution_id) SELECT ?,'Sede Principal','Villavicencio',id FROM public.institutions WHERE email_domain='ustavillavo.edu.co'",
        site);
    jdbc.update(
        "INSERT INTO public.cafeterias(id,site_id,name,is_active,lunch_order_start,lunch_order_end) VALUES (?,?,'Cafetería Central',false,'06:00','18:00')",
        CAFE,
        site);
    product(JUICE, "Jugo natural", "BEBIDA", 4500);
    product(LUNCH, "Corriente del día", "CORRIENTE", 13000);
    product(AREPA, "Arepa de queso", "DESAYUNO", 3500);
    staff(WORKER, "WORKER", CAFE);
    staff(ADMIN, "ADMIN", CAFE);
    staff(SUPER_ADMIN, "SUPER_ADMIN", null);
    staff(NO_PROFILE, "CLIENT", null);
  }

  static void product(UUID id, String name, String category, int price) {
    jdbc.update(
        "INSERT INTO public.lunches(id,cafeteria_id,name,price,category) VALUES (?,?,?,?,?::public.catalog_category)",
        id,
        CAFE,
        name,
        price,
        category);
  }

  static void staff(UUID id, String role, UUID cafeteria) {
    jdbc.execute(
        (Connection connection) -> {
          connection.setAutoCommit(false);
          var tx = new JdbcTemplate(new SingleConnectionDataSource(connection, true));
          tx.update("INSERT INTO auth.users(id,email) VALUES (?, ?)", id, id + "@example.invalid");
          tx.update(
              "INSERT INTO public.user_roles(user_id,role_id) SELECT ?,id FROM public.roles WHERE name::text=?",
              id,
              role);
          if (cafeteria != null)
            tx.update(
                "INSERT INTO public.cafeteria_users(user_id,cafeteria_id) VALUES (?,?)",
                id,
                cafeteria);
          tx.update("UPDATE public.users SET is_active=true WHERE id=?", id);
          connection.commit();
          connection.setAutoCommit(true);
          return null;
        });
  }

  /** A fresh active STUDENT with a document that no response may ever carry. */
  static UUID client() {
    UUID id = UUID.randomUUID();
    jdbc.update("INSERT INTO auth.users(id,email) VALUES (?, ?)", id, id + "@ustavillavo.edu.co");
    jdbc.update(
        "INSERT INTO public.clients(user_id,full_name,document,institution_id,client_type,institutional_code) "
            + "SELECT ?,'Ana Torres',?,id,'STUDENT',? FROM public.institutions WHERE email_domain='ustavillavo.edu.co'",
        id,
        "DOC-PRIVATE-" + CODES.get(),
        String.valueOf(CODES.incrementAndGet()));
    jdbc.update(
        "INSERT INTO public.user_roles(user_id,role_id) SELECT ?,id FROM public.roles WHERE name::text='CLIENT'",
        id);
    jdbc.update("UPDATE public.users SET is_active=true WHERE id=?", id);
    return id;
  }

  /**
   * A PENDING order with its items, as quantity pairs. It copies the client's document into the
   * legacy {@code client_document} column too, so a leak would show in any response.
   */
  static UUID order(UUID user, Instant createdAt, String note, Object... lines) {
    UUID id = UUID.randomUUID();
    int total = 0;
    for (int i = 0; i < lines.length; i += 2) total += price((UUID) lines[i]) * (int) lines[i + 1];
    jdbc.update(
        "INSERT INTO public.orders(id,cafeteria_id,client_id,client_name,client_document,status,total,note,created_at,client_code,client_type) "
            + "SELECT ?,?,c.id,c.full_name,c.document,'PENDING',?,?,?,c.institutional_code,c.client_type "
            + "FROM public.clients c WHERE c.user_id=?",
        id,
        CAFE,
        total,
        note,
        createdAt.atOffset(ZoneOffset.UTC),
        user);
    for (int i = 0; i < lines.length; i += 2) {
      UUID product = (UUID) lines[i];
      int quantity = (int) lines[i + 1];
      jdbc.update(
          "INSERT INTO public.order_items(order_id,cafeteria_id,lunch_id,lunch_name,unit_price,quantity,subtotal) "
              + "SELECT ?,?,id,name,price,?,price*? FROM public.lunches WHERE id=?",
          id,
          CAFE,
          quantity,
          quantity,
          product);
    }
    return id;
  }

  static int price(UUID product) {
    return jdbc.queryForObject(
        "SELECT price::int FROM public.lunches WHERE id=?", Integer.class, product);
  }

  /** Moves an order the way the worker, the client or the daily close would. */
  static void state(UUID order, String state) {
    var sql =
        switch (state) {
          case "PENDING" -> null;
          case "PREPARING", "READY" -> "UPDATE public.orders SET status='" + state + "' WHERE id=?";
          case "CALLED" -> "UPDATE public.orders SET status='CALLED', called_at=now() WHERE id=?";
          case "DELIVERED" ->
              "UPDATE public.orders SET status='DELIVERED', called_at=now(), delivered_at=now() WHERE id=?";
          case "NOT_COLLECTED" ->
              "UPDATE public.orders SET status='NOT_COLLECTED', called_at=now(), not_collected_at=now() WHERE id=?";
          case "CANCELLED_CLIENT" ->
              "UPDATE public.orders SET status='CANCELLED', cancelled_at=now(), cancellation_source='CLIENT' WHERE id=?";
          case "CANCELLED_SYSTEM" ->
              "UPDATE public.orders SET status='CANCELLED', cancelled_at=now(), cancellation_source='SYSTEM' WHERE id=?";
          case "REJECTED" ->
              "UPDATE public.orders SET status='CANCELLED', cancelled_at=now(), cancellation_source='WORKER', "
                  + "rejection_reason='Se acabó el producto', rejected_by='"
                  + WORKER
                  + "' WHERE id=?";
          default -> throw new IllegalArgumentException(state);
        };
    if (sql != null) jdbc.update(sql, order);
  }

  static long version(UUID order) {
    return jdbc.queryForObject("SELECT version FROM public.orders WHERE id=?", Long.class, order);
  }

  // ---------------------------------------------------------------- helpers

  static RequestPostProcessor as(UUID subject) {
    return jwt()
        .jwt(
            token ->
                token
                    .subject(subject.toString())
                    .claim("user_metadata", Map.of("role", "CLIENT", "clientId", "forged")))
        .authorities(new SimpleGrantedAuthority("ROLE_CLIENT"));
  }

  static ResultActions call(MockHttpServletRequestBuilder request, UUID user) throws Exception {
    if (user != null) request.with(as(user));
    return mvc.perform(request);
  }

  static ResultActions current(UUID user, String ifNoneMatch) throws Exception {
    var request = get("/api/me/orders/current");
    if (ifNoneMatch != null) request.header("If-None-Match", ifNoneMatch);
    return call(request, user);
  }

  static String etag(UUID user) throws Exception {
    return current(user, null)
        .andExpect(status().isOk())
        .andReturn()
        .getResponse()
        .getHeader("ETag");
  }

  static JsonNode json(MvcResult result) throws Exception {
    return JSON.readTree(result.getResponse().getContentAsString(StandardCharsets.UTF_8));
  }

  static JsonNode history(UUID user, String cursor, String limit) throws Exception {
    var request = get("/api/me/orders");
    if (cursor != null) request.param("cursor", cursor);
    if (limit != null) request.param("limit", limit);
    return json(call(request, user).andExpect(status().isOk()).andReturn());
  }

  /** The private document, the legacy column name and internal ids never leave Spring. */
  static void private_(MvcResult result) throws Exception {
    var body = result.getResponse().getContentAsString(StandardCharsets.UTF_8);
    assertFalse(body.contains("DOC-PRIVATE"), body);
    assertFalse(body.contains("ocument"), body);
    assertFalse(body.contains("clientId"), body);
    assertFalse(body.contains("rejectedBy"), body);
    assertFalse(body.contains(WORKER.toString()), body);
  }

  static void expectError(ResultActions result, int status, String code) throws Exception {
    result
        .andExpect(status().is(status))
        .andExpect(jsonPath("$.status").value(status))
        .andExpect(jsonPath("$.code").value(code))
        .andExpect(jsonPath("$.message").isString());
  }

  // ---------------------------------------------------------------- current order

  @Test
  void withoutAnActiveOrderTheCurrentOrderIsJsonNullWithAPollingTag() throws Exception {
    UUID user = client();
    state(order(user, NOW.minusSeconds(7200), null, JUICE, 1), "DELIVERED");
    var result =
        current(user, null)
            .andExpect(status().isOk())
            .andExpect(header().string("Cache-Control", "no-cache, private"))
            .andExpect(header().exists("ETag"))
            .andExpect(content().contentTypeCompatibleWith("application/json"))
            .andReturn();
    assertEquals("null", result.getResponse().getContentAsString());
    current(user, result.getResponse().getHeader("ETag")).andExpect(status().isNotModified());
  }

  @Test
  void theCurrentOrderCarriesItsItemsTotalsNoteAndMarksButNeverTheDocument() throws Exception {
    UUID user = client();
    state(order(user, NOW.minusSeconds(7200), null, JUICE, 1), "DELIVERED");
    UUID active = order(user, NOW.minusSeconds(60), "Sin hielo", JUICE, 2, AREPA, 1);
    state(active, "CALLED");
    var result =
        current(user, null)
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.id").value(active.toString()))
            .andExpect(jsonPath("$.status").value("CALLED"))
            .andExpect(jsonPath("$.total").value("12500.00"))
            .andExpect(jsonPath("$.note").value("Sin hielo"))
            .andExpect(jsonPath("$.createdAt").value(NOW.minusSeconds(60).toString()))
            .andExpect(jsonPath("$.items[0].name").value("Arepa de queso"))
            .andExpect(jsonPath("$.items[0].unitPrice").value("3500.00"))
            .andExpect(jsonPath("$.items[1].name").value("Jugo natural"))
            .andExpect(jsonPath("$.items[1].quantity").value(2))
            .andExpect(jsonPath("$.items[1].subtotal").value("9000.00"))
            .andExpect(jsonPath("$.cafeteria.id").value(CAFE.toString()))
            .andExpect(jsonPath("$.cafeteria.name").value("Cafetería Central"))
            .andExpect(jsonPath("$.cancellationSource").value(nullValue()))
            .andExpect(jsonPath("$.rejectionReason").value(nullValue()))
            .andExpect(jsonPath("$.calledAt").isString())
            .andExpect(jsonPath("$.updatedAt").isString())
            .andExpect(jsonPath("$.reminderCount").value(0))
            .andExpect(jsonPath("$.deliveredAt").value(nullValue()))
            .andExpect(jsonPath("$.*", hasSize(17)))
            .andReturn();
    private_(result);
  }

  @Test
  void aMatchingTagAnswers304WithoutReadingTheOrderOrItsItems() throws Exception {
    UUID user = client();
    order(user, NOW.minusSeconds(60), null, JUICE, 1);
    String tag = etag(user);
    for (String header : new String[] {tag, "W/" + tag, "\"other\", " + tag, "*"}) {
      source.sql.clear();
      var result =
          current(user, header)
              .andExpect(status().isNotModified())
              .andExpect(header().string("ETag", tag))
              .andExpect(header().string("Cache-Control", "no-cache, private"))
              .andReturn();
      assertEquals("", result.getResponse().getContentAsString());
      var statements = List.copyOf(source.sql);
      assertTrue(
          statements.stream().noneMatch(sql -> sql.contains("order_items")), statements::toString);
      assertTrue(
          statements.stream().noneMatch(sql -> sql.contains("JOIN public.cafeterias f")),
          statements::toString);
      // The authorization read and the one minimal tag query, nothing else.
      assertEquals(
          1,
          statements.stream().filter(sql -> sql.contains("LEFT JOIN public.orders o")).count(),
          statements::toString);
      assertEquals(2, statements.size(), statements::toString);
    }
    source.sql.clear();
    current(user, "\"stale\"").andExpect(status().isOk());
    assertTrue(source.sql.stream().anyMatch(sql -> sql.contains("order_items")));
  }

  @Test
  void everyChangeTheClientCanSeeChangesTheTag() throws Exception {
    UUID user = client();
    UUID order = order(user, NOW.minusSeconds(60), null, JUICE, 1);
    var tags = new ArrayList<String>();
    tags.add(etag(user));
    for (String next : new String[] {"PREPARING", "READY", "CALLED"}) {
      state(order, next);
      String tag = etag(user);
      current(user, tags.getLast()).andExpect(status().isOk());
      tags.add(tag);
    }
    // A reminder keeps the status CALLED; version and updated_at still move.
    jdbc.update(
        "UPDATE public.orders SET reminder_count=reminder_count+1, last_reminded_at=now() WHERE id=?",
        order);
    tags.add(etag(user));
    current(user, null).andExpect(jsonPath("$.reminderCount").value(1));
    state(order, "DELIVERED");
    tags.add(etag(user));
    assertEquals(tags.size(), tags.stream().distinct().count(), tags.toString());

    // A rejection and a client cancellation end the active order: the tag goes back to "none".
    UUID rejected = order(user, NOW.minusSeconds(30), null, JUICE, 1);
    String pending = etag(user);
    state(rejected, "REJECTED");
    String none = etag(user);
    assertNotEquals(pending, none);
    assertEquals(tags.getLast(), none);
    UUID cancelled = order(user, NOW.minusSeconds(20), null, JUICE, 1);
    String before = etag(user);
    call(patch("/api/me/orders/" + cancelled + "/cancel"), user).andExpect(status().isOk());
    current(user, before).andExpect(status().isOk()).andExpect(content().string("null"));
  }

  @Test
  void oneClientNeverSeesAnotherClientsCurrentOrder() throws Exception {
    UUID owner = client();
    UUID other = client();
    order(owner, NOW.minusSeconds(60), null, JUICE, 1);
    var result = current(other, null).andExpect(status().isOk()).andReturn();
    assertEquals("null", result.getResponse().getContentAsString());
    assertNotEquals(etag(owner), etag(other));
  }

  // ---------------------------------------------------------------- history

  /** 26 orders: ties on created_at, every terminal state and one still active. */
  static List<UUID> manyOrders(UUID user) {
    var ids = new ArrayList<UUID>();
    String[] terminal = {
      "DELIVERED", "NOT_COLLECTED", "CANCELLED_CLIENT", "REJECTED", "CANCELLED_SYSTEM"
    };
    for (int i = 0; i < 25; i++) {
      // Pairs share a created_at, so only the id breaks the tie.
      UUID id = order(user, NOW.minusSeconds(3600L * (30 - i / 2)), null, JUICE, 1 + i % 3);
      state(id, terminal[i % terminal.length]);
      ids.add(id);
    }
    ids.add(order(user, NOW.minusSeconds(60), null, LUNCH, 1));
    return ids;
  }

  static List<String> expectedHistory(UUID user) {
    return jdbc.queryForList(
        "SELECT o.id::text FROM public.orders o JOIN public.clients c ON c.id=o.client_id "
            + "WHERE c.user_id=? ORDER BY o.created_at DESC, o.id DESC",
        String.class,
        user);
  }

  @Test
  void historyPagesWithAnOpaqueCursorInOrderWithoutGapsOrRepeats() throws Exception {
    UUID user = client();
    manyOrders(user);
    UUID other = client();
    order(other, NOW.minusSeconds(10), null, JUICE, 1);

    var seen = new ArrayList<String>();
    var sizes = new ArrayList<Integer>();
    String cursor = null;
    do {
      var page = history(user, cursor, "10");
      sizes.add(page.get("orders").size());
      for (var entry : page.get("orders")) seen.add(entry.get("id").asString());
      cursor = page.get("nextCursor").isNull() ? null : page.get("nextCursor").asString();
      if (cursor != null) {
        assertTrue(cursor.matches("[A-Za-z0-9_-]+"), cursor);
        assertFalse(cursor.contains("-0000-"), "The cursor should not read as an id: " + cursor);
      }
    } while (cursor != null);
    assertEquals(List.of(10, 10, 6), sizes);
    assertEquals(expectedHistory(user), seen);
  }

  @Test
  void historyEntriesSummariseTheOrderAndIncludeTerminalOnes() throws Exception {
    UUID user = client();
    UUID three = order(user, NOW.minusSeconds(7200), null, JUICE, 2, LUNCH, 1, AREPA, 3);
    state(three, "REJECTED");
    UUID one = order(user, NOW.minusSeconds(3600), null, JUICE, 2);
    state(one, "DELIVERED");
    UUID two = order(user, NOW.minusSeconds(60), null, JUICE, 1, LUNCH, 1);
    var call = call(get("/api/me/orders"), user).andExpect(status().isOk());
    var result =
        call.andExpect(header().string("Cache-Control", "no-store"))
            .andExpect(jsonPath("$.orders", hasSize(3)))
            .andExpect(jsonPath("$.nextCursor").value(nullValue()))
            .andExpect(jsonPath("$.orders[0].id").value(two.toString()))
            .andExpect(jsonPath("$.orders[0].status").value("PENDING"))
            .andExpect(
                jsonPath("$.orders[0].summary").value("1× Corriente del día, 1× Jugo natural"))
            .andExpect(jsonPath("$.orders[0].itemCount").value(2))
            .andExpect(jsonPath("$.orders[1].status").value("DELIVERED"))
            .andExpect(jsonPath("$.orders[1].summary").value("2× Jugo natural"))
            .andExpect(jsonPath("$.orders[1].total").value("9000.00"))
            .andExpect(jsonPath("$.orders[2].id").value(three.toString()))
            .andExpect(jsonPath("$.orders[2].status").value("CANCELLED"))
            // Units add up; «más» counts the remaining distinct products, not units.
            .andExpect(jsonPath("$.orders[2].itemCount").value(6))
            .andExpect(
                jsonPath("$.orders[2].summary")
                    .value("3× Arepa de queso, 1× Corriente del día y 1 más"))
            .andExpect(jsonPath("$.orders[2].total").value("32500.00"))
            .andExpect(jsonPath("$.orders[2].cafeteriaName").value("Cafetería Central"))
            .andExpect(jsonPath("$.orders[2].createdAt").value(NOW.minusSeconds(7200).toString()))
            .andExpect(jsonPath("$.orders[0].*", hasSize(7)))
            .andReturn();
    private_(result);
  }

  @Test
  void historyDefaultsTo20AndAllowsUpTo50() throws Exception {
    UUID user = client();
    manyOrders(user);
    assertEquals(20, history(user, null, null).get("orders").size());
    assertEquals(20, history(user, "", "").get("orders").size());
    var all = history(user, null, "50");
    assertEquals(26, all.get("orders").size());
    assertTrue(all.get("nextCursor").isNull());
    assertEquals(1, history(user, null, "1").get("orders").size());
  }

  @ParameterizedTest
  @ValueSource(strings = {"0", "51", "-1", "1.5", "abc", "100", " 5", "5 ", "+5", "999999999999"})
  void aLimitOutside1To50IsTheOrderRequestCode(String limit) throws Exception {
    expectError(
        call(get("/api/me/orders").param("limit", limit), client()), 400, "INVALID_ORDER_REQUEST");
  }

  @Test
  void aManipulatedCursorIsABadRequest() throws Exception {
    UUID user = client();
    manyOrders(user);
    String real = history(user, null, "5").get("nextCursor").asString();
    var encoder = java.util.Base64.getUrlEncoder().withoutPadding();
    var bad =
        List.of(
            "not a cursor",
            "%%%",
            real + "A",
            real.substring(0, real.length() - 2),
            real.replace(real.charAt(3), real.charAt(3) == 'A' ? 'B' : 'A'),
            encoder.encodeToString("c1:abc:x".getBytes(StandardCharsets.UTF_8)),
            encoder.encodeToString(("c2:1:" + UUID.randomUUID()).getBytes(StandardCharsets.UTF_8)),
            encoder.encodeToString("c1:1:1-1-1-1-1".getBytes(StandardCharsets.UTF_8)),
            encoder.encodeToString(
                ("c1:1:" + UUID.randomUUID() + ":x").getBytes(StandardCharsets.UTF_8)),
            "A".repeat(200));
    for (String cursor : bad)
      expectError(
          call(get("/api/me/orders").param("cursor", cursor), user), 400, "INVALID_ORDER_REQUEST");
  }

  @Test
  void anotherClientsCursorStillOnlyListsTheSessionClientsOrders() throws Exception {
    UUID owner = client();
    manyOrders(owner);
    String cursor = history(owner, null, "3").get("nextCursor").asString();
    UUID other = client();
    UUID mine = order(other, NOW.minusSeconds(3600L * 40), null, JUICE, 1);
    var page = history(other, cursor, "50").get("orders");
    var ids = new ArrayList<String>();
    page.forEach(entry -> ids.add(entry.get("id").asString()));
    assertEquals(List.of(mine.toString()), ids);
  }

  @Test
  void historyQueriesCanUseTheClientHistoryIndex() throws Exception {
    for (String file : new String[] {"history-first.sql", "history-after.sql"}) {
      String sql =
          new ClassPathResource("sql/client-orders/" + file)
              .getContentAsString(StandardCharsets.UTF_8);
      String plan =
          jdbc.execute(
              (Connection connection) -> {
                try (var off = connection.createStatement()) {
                  off.execute("SET enable_seqscan = off");
                }
                try (var explain = connection.prepareStatement("EXPLAIN " + sql)) {
                  explain.setObject(1, UUID.randomUUID());
                  if (file.equals("history-after.sql")) {
                    explain.setObject(2, java.time.OffsetDateTime.parse("2026-11-20T17:00:00Z"));
                    explain.setObject(3, UUID.randomUUID());
                    explain.setInt(4, 21);
                  } else explain.setInt(2, 21);
                  var text = new StringBuilder();
                  try (var rows = explain.executeQuery()) {
                    while (rows.next()) text.append(rows.getString(1)).append('\n');
                  }
                  return text.toString();
                } finally {
                  try (var on = connection.createStatement()) {
                    on.execute("RESET enable_seqscan");
                  }
                }
              });
      assertTrue(plan.contains("idx_orders_client_history"), plan);
    }
  }

  // ---------------------------------------------------------------- detail

  @Test
  void theDetailOfAnOwnOrderIncludesWhoEndedItAndWhy() throws Exception {
    UUID user = client();
    UUID rejected = order(user, NOW.minusSeconds(600), "Bien caliente", JUICE, 1, LUNCH, 2);
    state(rejected, "REJECTED");
    var result =
        call(get("/api/me/orders/" + rejected), user)
            .andExpect(status().isOk())
            .andExpect(header().string("Cache-Control", "no-store"))
            .andExpect(jsonPath("$.id").value(rejected.toString()))
            .andExpect(jsonPath("$.status").value("CANCELLED"))
            .andExpect(jsonPath("$.cancellationSource").value("WORKER"))
            .andExpect(jsonPath("$.rejectionReason").value("Se acabó el producto"))
            .andExpect(jsonPath("$.cancelledAt").isString())
            .andExpect(jsonPath("$.note").value("Bien caliente"))
            .andExpect(jsonPath("$.total").value("30500.00"))
            .andExpect(jsonPath("$.items", hasSize(2)))
            .andExpect(jsonPath("$.*", hasSize(17)))
            .andReturn();
    private_(result);
    UUID system = order(user, NOW.minusSeconds(300), null, JUICE, 1);
    state(system, "CANCELLED_SYSTEM");
    call(get("/api/me/orders/" + system), user)
        .andExpect(jsonPath("$.cancellationSource").value("SYSTEM"))
        .andExpect(jsonPath("$.rejectionReason").value(nullValue()));
  }

  @Test
  void anotherClientsOrderAMissingOneAndAMalformedIdAreTheSame404() throws Exception {
    UUID owner = client();
    UUID foreign = order(owner, NOW.minusSeconds(60), null, JUICE, 1);
    UUID other = client();
    var bodies = new ArrayList<String>();
    for (String id :
        new String[] {
          foreign.toString(),
          UUID.randomUUID().toString(),
          "not-a-uuid",
          foreign.toString().toUpperCase()
        }) {
      var result = call(get("/api/me/orders/" + id), other);
      expectError(result, 404, "ORDER_NOT_FOUND");
      var json = json(result.andReturn());
      bodies.add(json.get("message").asString());
      private_(result.andReturn());
    }
    assertEquals(1, bodies.stream().distinct().count(), bodies.toString());
    assertFalse(bodies.getFirst().contains(foreign.toString()));
  }

  // ---------------------------------------------------------------- cancellation

  @Test
  void aPendingOrderIsCancelledByItsClientAndRepeatingItIsOkWithoutAnotherWrite() throws Exception {
    UUID user = client();
    UUID order = order(user, NOW.minusSeconds(60), null, JUICE, 1);
    long before = version(order);
    var result =
        call(patch("/api/me/orders/" + order + "/cancel"), user)
            .andExpect(status().isOk())
            .andExpect(header().string("Cache-Control", "no-store"))
            .andExpect(jsonPath("$.id").value(order.toString()))
            .andExpect(jsonPath("$.status").value("CANCELLED"))
            .andExpect(jsonPath("$.cancellationSource").value("CLIENT"))
            .andExpect(jsonPath("$.cancelledAt").value(NOW.toString()))
            .andExpect(jsonPath("$.items", hasSize(1)))
            .andReturn();
    private_(result);
    var row =
        jdbc.queryForMap(
            "SELECT status::text AS status, cancellation_source, cancelled_by_client, cancelled_at, version FROM public.orders WHERE id=?",
            order);
    assertEquals("CANCELLED", row.get("status"));
    assertEquals("CLIENT", row.get("cancellation_source"));
    assertEquals(true, row.get("cancelled_by_client"));
    assertEquals(before + 1, ((Number) row.get("version")).longValue());

    call(patch("/api/me/orders/" + order + "/cancel"), user)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.status").value("CANCELLED"))
        .andExpect(jsonPath("$.cancelledAt").value(NOW.toString()));
    assertEquals(before + 1, version(order));
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "PREPARING",
        "READY",
        "CALLED",
        "DELIVERED",
        "NOT_COLLECTED",
        "REJECTED",
        "CANCELLED_SYSTEM"
      })
  void anyOtherStateIsAConflictAndChangesNothing(String state) throws Exception {
    UUID user = client();
    UUID order = order(user, NOW.minusSeconds(60), null, JUICE, 1);
    state(order, state);
    var before =
        jdbc.queryForMap("SELECT to_jsonb(o)::text AS row FROM public.orders o WHERE id=?", order);
    var result = call(patch("/api/me/orders/" + order + "/cancel"), user);
    expectError(
        result, 409, state.equals("PREPARING") ? "ORDER_ALREADY_PREPARING" : "INVALID_ORDER_STATE");
    private_(result.andReturn());
    assertEquals(
        before,
        jdbc.queryForMap("SELECT to_jsonb(o)::text AS row FROM public.orders o WHERE id=?", order));
  }

  @Test
  void anotherClientCannotCancelAnOrderAndGetsTheSame404() throws Exception {
    UUID owner = client();
    UUID order = order(owner, NOW.minusSeconds(60), null, JUICE, 1);
    UUID other = client();
    expectError(call(patch("/api/me/orders/" + order + "/cancel"), other), 404, "ORDER_NOT_FOUND");
    expectError(
        call(patch("/api/me/orders/" + UUID.randomUUID() + "/cancel"), other),
        404,
        "ORDER_NOT_FOUND");
    assertEquals(
        "PENDING",
        jdbc.queryForObject(
            "SELECT status::text FROM public.orders WHERE id=?", String.class, order));
  }

  // ---------------------------------------------------------------- roles

  static List<MockHttpServletRequestBuilder> reads(UUID order) {
    return List.of(
        get("/api/me/orders/current"), get("/api/me/orders"), get("/api/me/orders/" + order));
  }

  @Test
  void workerAdminAndSuperAdminAreForbiddenOnEveryRead() throws Exception {
    UUID order = order(client(), NOW.minusSeconds(60), null, JUICE, 1);
    for (UUID staff : new UUID[] {WORKER, ADMIN, SUPER_ADMIN})
      for (var request : reads(order)) expectError(call(request, staff), 403, "FORBIDDEN");
  }

  @Test
  void withoutAValidTokenEveryReadIs401() throws Exception {
    UUID order = order(client(), NOW.minusSeconds(60), null, JUICE, 1);
    for (var request : reads(order)) call(request, null).andExpect(status().isUnauthorized());
    for (var request : reads(order))
      mvc.perform(request.header("Authorization", "Bearer forged.token.value"))
          .andExpect(status().isUnauthorized());
  }

  @Test
  void anInactiveClientAndACLientWithoutItsRowAreForbiddenBeforeValidation() throws Exception {
    UUID inactive = client();
    UUID order = order(inactive, NOW.minusSeconds(60), null, JUICE, 1);
    jdbc.update("UPDATE public.users SET is_active=false WHERE id=?", inactive);
    for (var request : reads(order)) expectError(call(request, inactive), 403, "FORBIDDEN");
    // No clients row: refused before the limit or cursor are even looked at.
    expectError(call(get("/api/me/orders/current"), NO_PROFILE), 403, "FORBIDDEN");
    expectError(
        call(get("/api/me/orders").param("limit", "999").param("cursor", "%%%"), NO_PROFILE),
        403,
        "FORBIDDEN");
    expectError(call(get("/api/me/orders/" + order), NO_PROFILE), 403, "FORBIDDEN");
  }
}

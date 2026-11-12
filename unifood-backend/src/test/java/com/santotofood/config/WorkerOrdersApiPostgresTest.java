package com.santotofood.config;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.santotofood.adapter.in.web.OrderController;
import com.santotofood.adapter.in.web.WorkerOrdersController;
import com.santotofood.adapter.in.web.error.GlobalExceptionHandler;
import com.santotofood.adapter.in.web.mapper.OrderResponseMapper;
import com.santotofood.adapter.out.persistence.AuthorizationPersistenceAdapter;
import com.santotofood.adapter.out.persistence.OrderItemPersistenceAdapter;
import com.santotofood.adapter.out.persistence.OrderPersistenceAdapter;
import com.santotofood.adapter.out.persistence.entity.OrderEntity;
import com.santotofood.adapter.out.persistence.entity.OrderItemEntity;
import com.santotofood.adapter.out.persistence.mapper.OrderItemMapper;
import com.santotofood.adapter.out.persistence.mapper.OrderMapper;
import com.santotofood.adapter.out.persistence.repository.SpringDataOrderItemRepository;
import com.santotofood.adapter.out.persistence.repository.SpringDataOrderRepository;
import com.santotofood.application.service.OrderService;
import com.santotofood.domain.port.out.OrderItemRepository;
import com.santotofood.domain.port.out.OrderRepository;
import com.santotofood.domain.port.out.TimeProvider;
import jakarta.persistence.EntityManagerFactory;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import javax.sql.DataSource;
import org.junit.jupiter.api.*;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.jpa.repository.support.JpaRepositoryFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;
import org.springframework.mock.web.MockServletContext;
import org.springframework.orm.jpa.JpaTransactionManager;
import org.springframework.orm.jpa.LocalContainerEntityManagerFactoryBean;
import org.springframework.orm.jpa.SharedEntityManagerCreator;
import org.springframework.orm.jpa.persistenceunit.PersistenceManagedTypes;
import org.springframework.orm.jpa.vendor.HibernateJpaVendorAdapter;
import org.springframework.security.oauth2.jwt.BadJwtException;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.transaction.annotation.EnableTransactionManagement;
import org.springframework.web.context.support.AnnotationConfigWebApplicationContext;
import org.springframework.web.servlet.config.annotation.EnableWebMvc;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * Worker orders on the real 001-021 schema: the listing keeps today's orders and every older active
 * one, shows the institutional code and client type but never the document (B20), and is scoped to
 * the worker's own cafeteria; the worker cancellation is gone. Also checks that the removed
 * institution endpoints answer nothing.
 */
@Timeout(120)
class WorkerOrdersApiPostgresTest {
  // Noon in America/Bogota; the business day started at 05:00Z.
  static final Instant NOW = Instant.parse("2026-11-20T17:00:00Z");
  static final Instant TODAY = Instant.parse("2026-11-20T14:00:00Z");
  static final Instant YESTERDAY = Instant.parse("2026-11-19T15:00:00Z");
  static final UUID CAFE = UUID.randomUUID();
  static final UUID OTHER_CAFE = UUID.randomUUID();
  static final UUID LUNCH = UUID.randomUUID();
  static final UUID WORKER = UUID.randomUUID();
  static final UUID OTHER_WORKER = UUID.randomUUID();
  static final AtomicInteger CODES = new AtomicInteger(3000000);
  static final JsonMapper JSON = JsonMapper.builder().build();
  static final Map<String, UUID> ORDERS = new HashMap<>();
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
    OrderService orders(OrderRepository orders, OrderItemRepository items, TimeProvider clock) {
      return new OrderService(orders, items, clock);
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
        OrderResponseMapper.class,
        OrderController.class,
        WorkerOrdersController.class,
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
    for (UUID cafe : new UUID[] {CAFE, OTHER_CAFE})
      jdbc.update(
          "INSERT INTO public.cafeterias(id,site_id,name,is_active,lunch_order_start,lunch_order_end) VALUES (?,?,?,false,'06:00','18:00')",
          cafe,
          site,
          cafe.equals(CAFE) ? "Cafetería Central" : "Cafetería Norte");
    jdbc.update(
        "INSERT INTO public.lunches(id,cafeteria_id,name,price,category) VALUES (?,?,'Corriente',13000,'CORRIENTE')",
        LUNCH,
        CAFE);
    staff(WORKER, "WORKER", CAFE);
    staff(OTHER_WORKER, "WORKER", OTHER_CAFE);

    UUID copied = client("STUDENT", "2000001");
    UUID staffWithCode = client("STAFF", "55555");
    UUID legacy = client("STUDENT", "2000003");
    INSTITUTION_READER_CLIENT = client("STUDENT", "2000004");

    // Today, with the 021 copy, which wins over the client's current code.
    ORDERS.put(
        "copied",
        order(CAFE, copied, "PREPARING", TODAY, "1999999", "STUDENT", null, "DOC-PRIVATE-A"));
    // Staff copy without a code: it stays without one, even though the client has one now.
    ORDERS.put(
        "staff", order(CAFE, staffWithCode, "READY", TODAY, null, "STAFF", null, "DOC-PRIVATE-B"));
    // Before 021: no copy, so code and type come from the client.
    ORDERS.put("legacy", order(CAFE, legacy, "CALLED", TODAY, null, null, null, "DOC-PRIVATE-C"));
    // Stuck from yesterday and anonymised: still listed, with neither code nor type.
    ORDERS.put("stale", order(CAFE, null, "PENDING", YESTERDAY, null, null, null, "DOC-PRIVATE-D"));
    ORDERS.put(
        "deliveredToday",
        order(CAFE, null, "DELIVERED", YESTERDAY, null, null, TODAY, "DOC-PRIVATE-E"));
    ORDERS.put(
        "deliveredYesterday",
        order(CAFE, null, "DELIVERED", YESTERDAY, null, null, YESTERDAY, "DOC-PRIVATE-F"));
    ORDERS.put(
        "cancelledToday", order(CAFE, null, "CANCELLED", TODAY, null, null, null, "DOC-PRIVATE-G"));
    ORDERS.put(
        "notCollectedToday",
        order(CAFE, null, "NOT_COLLECTED", TODAY, null, null, null, "DOC-PRIVATE-H"));
    ORDERS.put(
        "foreign",
        order(OTHER_CAFE, null, "PENDING", TODAY, null, null, null, "DOC-PRIVATE-FOREIGN"));
    jdbc.update(
        "UPDATE public.orders SET cancellation_deadline=? WHERE id=?",
        YESTERDAY.atOffset(ZoneOffset.UTC),
        ORDERS.get("foreign"));
  }

  static UUID INSTITUTION_READER_CLIENT;

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

  /** An active client with a private document; returns the users id. */
  static UUID client(String type, String code) {
    UUID id = UUID.randomUUID();
    String domain = type.equals("STUDENT") ? "ustavillavo.edu.co" : "ustavillavicencio.edu.co";
    jdbc.update("INSERT INTO auth.users(id,email) VALUES (?, ?)", id, id + "@" + domain);
    jdbc.update(
        "INSERT INTO public.clients(user_id,full_name,document,institution_id,client_type,institutional_code) "
            + "SELECT ?,'Ana Torres',?,id,?::public.client_type,? FROM public.institutions WHERE email_domain='ustavillavo.edu.co'",
        id,
        "DOC-PRIVATE-CLIENT-" + CODES.incrementAndGet(),
        type,
        code);
    jdbc.update(
        "INSERT INTO public.user_roles(user_id,role_id) SELECT ?,id FROM public.roles WHERE name::text='CLIENT'",
        id);
    jdbc.update("UPDATE public.users SET is_active=true WHERE id=?", id);
    return id;
  }

  static UUID order(
      UUID cafe,
      UUID user,
      String status,
      Instant created,
      String code,
      String type,
      Instant delivered,
      String document) {
    UUID id = UUID.randomUUID();
    jdbc.update(
        "INSERT INTO public.orders(id,cafeteria_id,client_id,client_name,client_document,status,total,created_at,"
            + "client_code,client_type,called_at,delivered_at,not_collected_at,cancelled_at,cancellation_source) "
            + "VALUES (?,?,(SELECT id FROM public.clients WHERE user_id=?),'Ana Torres',?,?::public.order_status,13000,?,"
            + "?,?::public.client_type,?,?,?,?,?)",
        id,
        cafe,
        user,
        document,
        status,
        created.atOffset(ZoneOffset.UTC),
        code,
        type,
        Set.of("CALLED", "DELIVERED", "NOT_COLLECTED").contains(status)
            ? created.atOffset(ZoneOffset.UTC)
            : null,
        delivered == null ? null : delivered.atOffset(ZoneOffset.UTC),
        status.equals("NOT_COLLECTED") ? created.atOffset(ZoneOffset.UTC) : null,
        status.equals("CANCELLED") ? created.atOffset(ZoneOffset.UTC) : null,
        status.equals("CANCELLED") ? "CLIENT" : null);
    if (cafe.equals(CAFE))
      jdbc.update(
          "INSERT INTO public.order_items(order_id,cafeteria_id,lunch_id,lunch_name,unit_price,quantity,subtotal) VALUES (?,?,?,'Corriente',13000,1,13000)",
          id,
          cafe,
          LUNCH);
    return id;
  }

  static RequestPostProcessor as(UUID subject) {
    return jwt()
        .jwt(
            token ->
                token
                    .subject(subject.toString())
                    .claim("user_metadata", Map.of("role", "WORKER", "cafeteriaId", "forged")));
  }

  static Map<String, JsonNode> listing(MvcResult result) throws Exception {
    var byId = new HashMap<String, JsonNode>();
    for (var order : JSON.readTree(result.getResponse().getContentAsString(StandardCharsets.UTF_8)))
      byId.put(order.get("id").asString(), order);
    return byId;
  }

  static Map<String, Object> row(UUID order) {
    return jdbc.queryForMap(
        "SELECT status::text AS status, client_document, cancellation_deadline, client_code, client_type FROM public.orders WHERE id=?",
        order);
  }

  // ---------------------------------------------------------------- listing

  @Test
  void theListingKeepsTodayAndEveryOlderActiveOrderOfTheWorkersCafeteriaOnly() throws Exception {
    var result =
        mvc.perform(get("/api/orders").param("cafeteriaId", CAFE.toString()).with(as(WORKER)))
            .andExpect(status().isOk())
            .andExpect(header().string("X-Business-Date", "2026-11-20"))
            .andReturn();
    var ids = listing(result).keySet();
    assertEquals(
        Set.of(
            ORDERS.get("copied").toString(),
            ORDERS.get("staff").toString(),
            ORDERS.get("legacy").toString(),
            ORDERS.get("stale").toString(),
            ORDERS.get("deliveredToday").toString()),
        ids);
  }

  @Test
  void theWorkerSeesNameCodeAndTypeButNeverTheDocument() throws Exception {
    var result =
        mvc.perform(get("/api/orders").param("cafeteriaId", CAFE.toString()).with(as(WORKER)))
            .andExpect(status().isOk())
            .andReturn();
    var body = result.getResponse().getContentAsString(StandardCharsets.UTF_8);
    assertFalse(body.contains("DOC-PRIVATE"), body);
    assertFalse(body.contains("ocument"), body);
    assertFalse(body.contains("cancellationDeadline"), body);
    var orders = listing(result);

    var copied = orders.get(ORDERS.get("copied").toString());
    assertEquals("Ana Torres", copied.get("clientName").asString());
    assertEquals("1999999", copied.get("clientCode").asString());
    assertEquals("STUDENT", copied.get("clientType").asString());

    var staff = orders.get(ORDERS.get("staff").toString());
    assertTrue(staff.get("clientCode").isNull(), staff.toString());
    assertEquals("STAFF", staff.get("clientType").asString());

    var legacy = orders.get(ORDERS.get("legacy").toString());
    assertEquals("2000003", legacy.get("clientCode").asString());
    assertEquals("STUDENT", legacy.get("clientType").asString());

    var stale = orders.get(ORDERS.get("stale").toString());
    assertTrue(stale.get("clientCode").isNull());
    assertTrue(stale.get("clientType").isNull());
  }

  @Test
  void anotherCafeteriaIdInTheQueryIsForbidden() throws Exception {
    mvc.perform(get("/api/orders").param("cafeteriaId", OTHER_CAFE.toString()).with(as(WORKER)))
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.code").value("FORBIDDEN"));
  }

  // ---------------------------------------------------------------- single call

  @Test
  void theSingleCallListsTheSameOrdersAsTheTwoCallFlowWithoutTheDocument() throws Exception {
    var single =
        mvc.perform(
                get("/api/worker/orders")
                    .param("cafeteriaId", OTHER_CAFE.toString())
                    .with(as(WORKER)))
            .andExpect(status().isOk())
            .andExpect(header().string("Cache-Control", "no-store"))
            .andExpect(header().string("X-Business-Date", "2026-11-20"))
            .andExpect(header().string("X-Next-Business-Date-At", "2026-11-21T05:00:00Z"))
            .andReturn();
    var body = single.getResponse().getContentAsString(StandardCharsets.UTF_8);
    assertFalse(body.contains("DOC-PRIVATE"), body);
    assertFalse(body.contains("ocument"), body);
    var twoCalls =
        mvc.perform(get("/api/orders").param("cafeteriaId", CAFE.toString()).with(as(WORKER)))
            .andExpect(status().isOk())
            .andReturn();
    // The query parameter is ignored: the database assignment selects CAFE, never OTHER_CAFE.
    assertEquals(listing(twoCalls).keySet(), listing(single).keySet());
    assertFalse(listing(single).containsKey(ORDERS.get("foreign").toString()));
  }

  @Test
  void eachWorkerGetsOnlyItsOwnCafeteriaFromTheSingleCall() throws Exception {
    var other =
        mvc.perform(get("/api/worker/orders").with(as(OTHER_WORKER)))
            .andExpect(status().isOk())
            .andReturn();
    var ids = listing(other).keySet();
    assertTrue(ids.contains(ORDERS.get("foreign").toString()), ids.toString());
    for (String key : new String[] {"copied", "staff", "legacy", "stale", "deliveredToday"})
      assertFalse(ids.contains(ORDERS.get(key).toString()), key);
  }

  @Test
  void anInactiveWorkerAndAClientGetTheFixed403OnTheSingleCall() throws Exception {
    UUID inactive = UUID.randomUUID();
    staff(inactive, "WORKER", CAFE);
    mvc.perform(get("/api/worker/orders").with(as(inactive))).andExpect(status().isOk());
    jdbc.update("UPDATE public.users SET is_active=false WHERE id=?", inactive);
    for (UUID subject : new UUID[] {inactive, INSTITUTION_READER_CLIENT, UUID.randomUUID()})
      mvc.perform(get("/api/worker/orders").with(as(subject)))
          .andExpect(status().isForbidden())
          .andExpect(jsonPath("$.code").value("FORBIDDEN"))
          .andExpect(
              jsonPath("$.message").value("No tienes permisos para realizar esta operación"));
    mvc.perform(get("/api/worker/orders")).andExpect(status().isUnauthorized());
  }

  // ---------------------------------------------------------------- operations

  @Test
  void aWorkerCannotOperateAnotherCafeteriasOrderButItsOwnWorkerCan() throws Exception {
    UUID foreign = ORDERS.get("foreign");
    var before = row(foreign);
    mvc.perform(patch("/api/orders/" + foreign + "/prepare").with(as(WORKER)))
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.code").value("FORBIDDEN"));
    assertEquals(before, row(foreign));

    // Its own worker can; the JPA update leaves the unmapped history columns untouched.
    var prepared =
        mvc.perform(patch("/api/orders/" + foreign + "/prepare").with(as(OTHER_WORKER)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.status").value("PREPARING"))
            .andReturn();
    assertFalse(prepared.getResponse().getContentAsString().contains("DOC-PRIVATE"));
    var after = row(foreign);
    assertEquals("PREPARING", after.get("status"));
    assertEquals("DOC-PRIVATE-FOREIGN", after.get("client_document"));
    assertEquals(before.get("cancellation_deadline"), after.get("cancellation_deadline"));
  }

  // ---------------------------------------------------------------- pickup time (023)

  static UUID orderPickingUpAt(Instant created, Instant pickup) {
    return orderPickingUpAt("PENDING", created, pickup);
  }

  /**
   * In the other cafeteria, so the exact listing of CAFE above stays as it is. Created after the
   * "foreign" order, which therefore stays first in its FIFO queue.
   */
  static UUID orderPickingUpAt(String status, Instant created, Instant pickup) {
    UUID id = order(OTHER_CAFE, null, status, created, null, null, null, "DOC-PRIVATE-P");
    jdbc.update(
        "UPDATE public.orders SET requested_pickup_at=? WHERE id=?",
        pickup == null ? null : pickup.atOffset(ZoneOffset.UTC),
        id);
    return id;
  }

  static Instant pickupOf(UUID order) {
    var value =
        jdbc.queryForObject(
            "SELECT requested_pickup_at FROM public.orders WHERE id=?",
            java.time.OffsetDateTime.class,
            order);
    return value == null ? null : value.toInstant();
  }

  @Test
  void thePickupTimeIsShownButTheQueueStaysInArrivalOrder() throws Exception {
    // The first to arrive wants it later than the second: the queue still serves it first.
    var lateWish = Instant.parse("2026-11-20T18:45:00Z");
    var earlyWish = Instant.parse("2026-11-20T17:30:00Z");
    UUID first = orderPickingUpAt(TODAY.plusSeconds(60), lateWish);
    UUID second = orderPickingUpAt(TODAY.plusSeconds(120), earlyWish);
    UUID asap = orderPickingUpAt(TODAY.plusSeconds(180), null);

    var result =
        mvc.perform(
                get("/api/orders")
                    .param("cafeteriaId", OTHER_CAFE.toString())
                    .with(as(OTHER_WORKER)))
            .andExpect(status().isOk())
            .andReturn();
    var ids = new java.util.ArrayList<String>();
    var byId = new HashMap<String, JsonNode>();
    for (var order :
        JSON.readTree(result.getResponse().getContentAsString(StandardCharsets.UTF_8))) {
      ids.add(order.get("id").asString());
      byId.put(order.get("id").asString(), order);
    }
    assertTrue(ids.indexOf(first.toString()) < ids.indexOf(second.toString()), ids.toString());
    assertTrue(ids.indexOf(second.toString()) < ids.indexOf(asap.toString()), ids.toString());
    assertEquals(
        "2026-11-20T18:45:00Z", byId.get(first.toString()).get("requestedPickupAt").asString());
    assertEquals(
        "2026-11-20T17:30:00Z", byId.get(second.toString()).get("requestedPickupAt").asString());
    assertTrue(byId.get(asap.toString()).get("requestedPickupAt").isNull());
  }

  @Test
  void workerTransitionsKeepThePickupTime() throws Exception {
    var wish = Instant.parse("2026-11-20T18:15:00Z");
    // Already in preparation: prepare itself is FIFO-bound and covered by the order tests.
    UUID order = orderPickingUpAt("PREPARING", TODAY.plusSeconds(240), wish);
    mvc.perform(patch("/api/orders/" + order + "/ready").with(as(OTHER_WORKER)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.status").value("READY"))
        .andExpect(jsonPath("$.requestedPickupAt").value("2026-11-20T18:15:00Z"));
    mvc.perform(patch("/api/orders/" + order + "/call").with(as(OTHER_WORKER)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.status").value("CALLED"))
        .andExpect(jsonPath("$.requestedPickupAt").value("2026-11-20T18:15:00Z"));
    // The JPA entity maps it read-only, so no transition rewrites the column.
    assertEquals(wish, pickupOf(order));
  }

  @Test
  void theWorkerCancellationRouteIsGone() throws Exception {
    UUID stale = ORDERS.get("stale");
    var status =
        mvc.perform(patch("/api/orders/" + stale + "/cancel").with(as(WORKER)))
            .andReturn()
            .getResponse()
            .getStatus();
    assertEquals(404, status);
    assertEquals("PENDING", row(stale).get("status"));
  }

  // ---------------------------------------------------------------- institutions

  @Test
  void theInstitutionEndpointsNoLongerAnswerAnyone() throws Exception {
    UUID institution =
        jdbc.queryForObject(
            "SELECT id FROM public.institutions WHERE email_domain='ustavillavo.edu.co'",
            UUID.class);
    for (String path :
        new String[] {
          "/api/institutions/" + institution,
          "/api/institutions/by-domain?domain=ustavillavo.edu.co"
        }) {
      mvc.perform(get(path)).andExpect(status().isUnauthorized());
      var client =
          mvc.perform(get(path).with(as(INSTITUTION_READER_CLIENT))).andReturn().getResponse();
      assertEquals(404, client.getStatus(), path);
      var body = client.getContentAsString(StandardCharsets.UTF_8);
      // Only the generic 404; the path echoes the URL, but no institution data comes back.
      assertTrue(body.contains("\"code\":\"NOT_FOUND\""), body);
      assertFalse(body.contains("Santo Tom"), body);
      assertFalse(body.contains("emailDomain"), body);
      assertFalse(body.contains("brandName"), body);
    }
  }
}

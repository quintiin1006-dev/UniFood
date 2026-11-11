package com.santotofood.config;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.santotofood.adapter.in.web.ClientOrderController;
import com.santotofood.adapter.in.web.OrderController;
import com.santotofood.adapter.in.web.error.ClientOrderExceptionHandler;
import com.santotofood.adapter.in.web.error.GlobalExceptionHandler;
import com.santotofood.adapter.in.web.mapper.OrderResponseMapper;
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
import com.santotofood.application.port.in.CreateOwnOrderUseCase;
import com.santotofood.application.service.ClientOrderQueryService;
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
import org.springframework.data.jpa.repository.support.JpaRepositoryFactory;
import org.springframework.http.MediaType;
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
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.transaction.annotation.EnableTransactionManagement;
import org.springframework.web.context.support.AnnotationConfigWebApplicationContext;
import org.springframework.web.servlet.config.annotation.EnableWebMvc;

/**
 * B18 worker rejection on the real 001-021 schema: the 021 checks and trigger accept what Spring
 * writes, the guards keep it to the worker of the order's cafeteria, and the client then reads the
 * reason and source, never who rejected it.
 */
@Timeout(120)
class WorkerRejectApiPostgresTest {
  static final Instant NOW = Instant.parse("2026-11-20T17:00:00Z");
  static final UUID CAFE = UUID.randomUUID();
  static final UUID OTHER_CAFE = UUID.randomUUID();
  static final UUID LUNCH = UUID.randomUUID();
  static final UUID WORKER = UUID.randomUUID();
  static final UUID COWORKER = UUID.randomUUID();
  static final UUID OTHER_WORKER = UUID.randomUUID();
  static final AtomicInteger CODES = new AtomicInteger(4000000);
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
    staff(WORKER, CAFE);
    staff(COWORKER, CAFE);
    staff(OTHER_WORKER, OTHER_CAFE);
  }

  static void staff(UUID id, UUID cafeteria) {
    jdbc.execute(
        (Connection connection) -> {
          connection.setAutoCommit(false);
          var tx = new JdbcTemplate(new SingleConnectionDataSource(connection, true));
          tx.update("INSERT INTO auth.users(id,email) VALUES (?, ?)", id, id + "@example.invalid");
          tx.update(
              "INSERT INTO public.user_roles(user_id,role_id) SELECT ?,id FROM public.roles WHERE name::text='WORKER'",
              id);
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

  /** A PENDING order of {@code user} in {@code cafe}, moved to {@code state} by plain SQL. */
  static UUID order(UUID user, UUID cafe, String state) {
    UUID id = UUID.randomUUID();
    jdbc.update(
        "INSERT INTO public.orders(id,cafeteria_id,client_id,client_name,status,total,created_at,client_code,client_type) "
            + "SELECT ?,?,c.id,c.full_name,'PENDING',13000,?,c.institutional_code,c.client_type FROM public.clients c WHERE c.user_id=?",
        id,
        cafe,
        NOW.minusSeconds(1800).atOffset(ZoneOffset.UTC),
        user);
    if (cafe.equals(CAFE))
      jdbc.update(
          "INSERT INTO public.order_items(order_id,cafeteria_id,lunch_id,lunch_name,unit_price,quantity,subtotal) VALUES (?,?,?,'Corriente',13000,1,13000)",
          id,
          cafe,
          LUNCH);
    String sql =
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
          default -> throw new IllegalArgumentException(state);
        };
    if (sql != null) jdbc.update(sql, id);
    return id;
  }

  static Map<String, Object> row(UUID order) {
    return jdbc.queryForMap(
        "SELECT status::text AS status, cancellation_source, rejection_reason, rejected_by, cancelled_at, "
            + "cancelled_by_client, version FROM public.orders WHERE id=?",
        order);
  }

  static RequestPostProcessor as(UUID subject) {
    return jwt()
        .jwt(
            token ->
                token
                    .subject(subject.toString())
                    .claim("user_metadata", Map.of("role", "WORKER", "cafeteriaId", "forged")));
  }

  static ResultActions reject(UUID order, UUID user, String body) throws Exception {
    MockHttpServletRequestBuilder request = patch("/api/orders/" + order + "/reject");
    if (body != null) request.contentType(MediaType.APPLICATION_JSON).content(body);
    if (user != null) request.with(as(user));
    return mvc.perform(request);
  }

  static String reason(String text) {
    return "{\"reason\":\"" + text + "\"}";
  }

  static void expectError(ResultActions result, int status, String code) throws Exception {
    result
        .andExpect(status().is(status))
        .andExpect(jsonPath("$.status").value(status))
        .andExpect(jsonPath("$.code").value(code))
        .andExpect(jsonPath("$.message").isString());
  }

  // ---------------------------------------------------------------- rejection

  @ParameterizedTest
  @ValueSource(strings = {"PENDING", "PREPARING"})
  void theWorkerRejectsPendingAndPreparingOrdersAndThe021ChecksAcceptIt(String state)
      throws Exception {
    UUID order = order(client(), CAFE, state);
    long version = ((Number) row(order).get("version")).longValue();
    var body =
        reject(order, WORKER, reason("  Se acabó el pollo  "))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.id").value(order.toString()))
            .andExpect(jsonPath("$.status").value("CANCELLED"))
            .andReturn()
            .getResponse()
            .getContentAsString(StandardCharsets.UTF_8);
    assertFalse(body.contains(WORKER.toString()), body);
    var row = row(order);
    assertEquals("CANCELLED", row.get("status"));
    assertEquals("WORKER", row.get("cancellation_source"));
    assertEquals("Se acabó el pollo", row.get("rejection_reason"));
    assertEquals(WORKER, row.get("rejected_by"));
    assertEquals(false, row.get("cancelled_by_client"));
    assertEquals(NOW, ((java.sql.Timestamp) row.get("cancelled_at")).toInstant());
    assertEquals(version + 1, ((Number) row.get("version")).longValue());
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "READY",
        "CALLED",
        "DELIVERED",
        "NOT_COLLECTED",
        "CANCELLED_CLIENT",
        "CANCELLED_SYSTEM"
      })
  void anyOtherStateIsAConflictAndChangesNothing(String state) throws Exception {
    UUID order = order(client(), CAFE, state);
    var before = row(order);
    expectError(reject(order, WORKER, reason("Se acabó el pollo")), 409, "INVALID_ORDER_STATE");
    assertEquals(before, row(order));
  }

  @Test
  void repeatingTheSameWorkersRejectionIsOkWithoutAnotherWriteButACoworkerConflicts()
      throws Exception {
    UUID order = order(client(), CAFE, "PENDING");
    reject(order, WORKER, reason("Se acabó el pollo")).andExpect(status().isOk());
    var after = row(order);
    reject(order, WORKER, reason("Otro motivo"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.status").value("CANCELLED"));
    assertEquals(after, row(order));
    expectError(reject(order, COWORKER, reason("Se acabó el pollo")), 409, "INVALID_ORDER_STATE");
    assertEquals(after, row(order));
  }

  @Test
  void theReasonIsTrimmedAndMustHave3To200Characters() throws Exception {
    UUID order = order(client(), CAFE, "PENDING");
    var before = row(order);
    for (String body :
        new String[] {null, "{}", "{\"reason\":null}", reason(""), reason("   "), reason("  ab  ")})
      expectError(reject(order, WORKER, body), 400, "REJECTION_REASON_REQUIRED");
    expectError(reject(order, WORKER, reason("x".repeat(201))), 400, "REJECTION_REASON_TOO_LONG");
    expectError(reject(order, WORKER, "{not json"), 400, "INVALID_REQUEST");
    assertEquals(before, row(order));
    reject(order, WORKER, reason("ñ".repeat(200))).andExpect(status().isOk());
    assertEquals("ñ".repeat(200), row(order).get("rejection_reason"));
  }

  // ---------------------------------------------------------------- guards

  @Test
  void anotherCafeteriasOrderAndAMissingOneAreTheSame403() throws Exception {
    UUID foreign = order(client(), OTHER_CAFE, "PENDING");
    var before = row(foreign);
    var foreignBody =
        reject(foreign, WORKER, reason("Se acabó el pollo"))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.code").value("FORBIDDEN"))
            .andReturn()
            .getResponse()
            .getContentAsString(StandardCharsets.UTF_8);
    var missingBody =
        reject(UUID.randomUUID(), WORKER, reason("Se acabó el pollo"))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.code").value("FORBIDDEN"))
            .andReturn()
            .getResponse()
            .getContentAsString(StandardCharsets.UTF_8);
    assertEquals(
        foreignBody.replaceAll("\"(timestamp|path)\":\"[^\"]*\"", ""),
        missingBody.replaceAll("\"(timestamp|path)\":\"[^\"]*\"", ""));
    assertEquals(before, row(foreign));
    // Its own worker can.
    reject(foreign, OTHER_WORKER, reason("Se acabó el pollo")).andExpect(status().isOk());
  }

  @Test
  void aClientAnAnonymousAndAForgedTokenCannotReject() throws Exception {
    UUID owner = client();
    UUID order = order(owner, CAFE, "PENDING");
    var before = row(order);
    expectError(reject(order, owner, reason("No lo quiero")), 403, "FORBIDDEN");
    reject(order, null, reason("Se acabó el pollo")).andExpect(status().isUnauthorized());
    mvc.perform(
            patch("/api/orders/" + order + "/reject")
                .header("Authorization", "Bearer forged.token.value")
                .contentType(MediaType.APPLICATION_JSON)
                .content(reason("Se acabó el pollo")))
        .andExpect(status().isUnauthorized());
    assertEquals(before, row(order));
  }

  // ---------------------------------------------------------------- what the client sees

  @Test
  void theClientSeesTheSourceAndReasonButNeverWhoRejected() throws Exception {
    UUID owner = client();
    UUID order = order(owner, CAFE, "PREPARING");
    reject(order, WORKER, reason("Se acabó el pollo")).andExpect(status().isOk());

    var current =
        mvc.perform(get("/api/me/orders/current").with(as(owner)))
            .andExpect(status().isOk())
            .andReturn()
            .getResponse()
            .getContentAsString();
    assertEquals("null", current);

    var detail =
        mvc.perform(get("/api/me/orders/" + order).with(as(owner)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.status").value("CANCELLED"))
            .andExpect(jsonPath("$.cancellationSource").value("WORKER"))
            .andExpect(jsonPath("$.rejectionReason").value("Se acabó el pollo"))
            .andExpect(jsonPath("$.cancelledAt").value(NOW.toString()))
            .andReturn()
            .getResponse()
            .getContentAsString(StandardCharsets.UTF_8);
    var history =
        mvc.perform(get("/api/me/orders").with(as(owner)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.orders[0].id").value(order.toString()))
            .andExpect(jsonPath("$.orders[0].status").value("CANCELLED"))
            .andReturn()
            .getResponse()
            .getContentAsString(StandardCharsets.UTF_8);
    for (String body : new String[] {detail, history}) {
      assertFalse(body.contains(WORKER.toString()), body);
      assertFalse(body.contains("rejectedBy"), body);
      assertFalse(body.contains("rejected_by"), body);
    }

    // Another client never sees it.
    mvc.perform(get("/api/me/orders/" + order).with(as(client())))
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.code").value("ORDER_NOT_FOUND"));
  }

  @Test
  void aRejectedOrderFreesTheClientAndCannotBeCancelledByThem() throws Exception {
    UUID owner = client();
    UUID order = order(owner, CAFE, "PENDING");
    reject(order, WORKER, reason("Se acabó el pollo")).andExpect(status().isOk());
    expectError(
        mvc.perform(patch("/api/me/orders/" + order + "/cancel").with(as(owner))),
        409,
        "INVALID_ORDER_STATE");
    // The 020 index no longer counts it as active: a new order for the same client fits.
    order(owner, CAFE, "PENDING");
    assertEquals(
        2,
        jdbc.queryForObject(
            "SELECT count(*) FROM public.orders o JOIN public.clients c ON c.id=o.client_id WHERE c.user_id=?",
            Integer.class,
            owner));
  }
}

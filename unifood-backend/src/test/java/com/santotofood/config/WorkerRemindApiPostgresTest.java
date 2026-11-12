package com.santotofood.config;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
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
import java.util.concurrent.atomic.AtomicReference;
import javax.sql.DataSource;
import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
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
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.transaction.annotation.EnableTransactionManagement;
import org.springframework.web.context.support.AnnotationConfigWebApplicationContext;
import org.springframework.web.servlet.config.annotation.EnableWebMvc;

/**
 * The worker's reminder and manual "no recogido" on the real schema: the same guards as the other
 * transitions, the 5-minute spacing and 3-reminder limit, and the 409 contract of docs section 11.
 */
@Timeout(120)
class WorkerRemindApiPostgresTest {
  static final Instant NOW = Instant.parse("2026-11-20T17:00:00Z");
  static final AtomicReference<Instant> CLOCK = new AtomicReference<>(NOW);
  static final UUID CAFE = UUID.randomUUID();
  static final UUID OTHER_CAFE = UUID.randomUUID();
  static final UUID LUNCH = UUID.randomUUID();
  static final UUID WORKER = UUID.randomUUID();
  static final UUID COWORKER = UUID.randomUUID();
  static final UUID OTHER_WORKER = UUID.randomUUID();
  static final AtomicInteger CODES = new AtomicInteger(4100000);
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
      return CLOCK::get;
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

  /** An order of {@code user} in {@code cafe}; CALLED ones were called at {@link #NOW}. */
  static UUID order(UUID user, UUID cafe, String state, int reminders) {
    UUID id = UUID.randomUUID();
    jdbc.update(
        "INSERT INTO public.orders(id,cafeteria_id,client_id,client_name,status,total,created_at,client_code,client_type) "
            + "SELECT ?,?,c.id,c.full_name,'PENDING',13000,?,c.institutional_code,c.client_type FROM public.clients c WHERE c.user_id=?",
        id,
        cafe,
        NOW.minusSeconds(1800).atOffset(ZoneOffset.UTC),
        user);
    var called = NOW.atOffset(ZoneOffset.UTC);
    var reminded =
        reminders == 0 ? null : NOW.plusSeconds(300L * reminders).atOffset(ZoneOffset.UTC);
    switch (state) {
      case "PENDING" -> {}
      case "PREPARING", "READY" ->
          jdbc.update(
              "UPDATE public.orders SET status='" + state + "'::public.order_status WHERE id=?",
              id);
      case "CALLED" ->
          jdbc.update(
              "UPDATE public.orders SET status='CALLED', called_at=?, reminder_count=?, last_reminded_at=? WHERE id=?",
              called,
              reminders,
              reminded,
              id);
      case "DELIVERED" ->
          jdbc.update(
              "UPDATE public.orders SET status='DELIVERED', called_at=?, delivered_at=? WHERE id=?",
              called,
              called,
              id);
      case "CANCELLED" ->
          jdbc.update(
              "UPDATE public.orders SET status='CANCELLED', cancelled_at=now(), cancellation_source='CLIENT' WHERE id=?",
              id);
      default -> throw new IllegalArgumentException(state);
    }
    return id;
  }

  static Map<String, Object> row(UUID order) {
    return jdbc.queryForMap(
        "SELECT status::text AS status, reminder_count, last_reminded_at, not_collected_at, version "
            + "FROM public.orders WHERE id=?",
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

  static ResultActions act(UUID order, String action, UUID user, Instant at) throws Exception {
    CLOCK.set(at);
    MockHttpServletRequestBuilder request = patch("/api/orders/" + order + "/" + action);
    if (user != null) request.with(as(user));
    return mvc.perform(request);
  }

  static void expectError(ResultActions result, int status, String code) throws Exception {
    result
        .andExpect(status().is(status))
        .andExpect(jsonPath("$.status").value(status))
        .andExpect(jsonPath("$.code").value(code))
        .andExpect(jsonPath("$.message").isString());
  }

  static Instant at(long seconds) {
    return NOW.plusSeconds(seconds);
  }

  @AfterEach
  void resetClock() {
    CLOCK.set(NOW);
  }

  // ---------------------------------------------------------------- reminders

  @Test
  void threeRemindersFiveMinutesApartAreSavedAndTheWorkerSeesThem() throws Exception {
    UUID order = order(client(), CAFE, "CALLED", 0);
    expectError(act(order, "remind", WORKER, at(299)), 409, "REMINDER_TOO_EARLY");
    assertEquals(0, ((Number) row(order).get("reminder_count")).intValue());
    for (int i = 1; i <= 3; i++) {
      act(order, "remind", WORKER, at(300L * i))
          .andExpect(status().isOk())
          .andExpect(jsonPath("$.status").value("CALLED"))
          .andExpect(jsonPath("$.reminderCount").value(i))
          .andExpect(jsonPath("$.calledAt").value(NOW.toString()))
          .andExpect(jsonPath("$.lastRemindedAt").value(at(300L * i).toString()));
    }
    var row = row(order);
    assertEquals(3, ((Number) row.get("reminder_count")).intValue());
    assertEquals(at(900), ((java.sql.Timestamp) row.get("last_reminded_at")).toInstant());
  }

  @Test
  void repeatingAReminderRightAwayIsTooEarlyAndChangesNothing() throws Exception {
    UUID order = order(client(), CAFE, "CALLED", 0);
    act(order, "remind", WORKER, at(300)).andExpect(status().isOk());
    var after = row(order);
    expectError(act(order, "remind", WORKER, at(310)), 409, "REMINDER_TOO_EARLY");
    expectError(act(order, "remind", COWORKER, at(599)), 409, "REMINDER_TOO_EARLY");
    assertEquals(after, row(order));
  }

  @Test
  void aFourthReminderReachesTheLimitAndChangesNothing() throws Exception {
    UUID order = order(client(), CAFE, "CALLED", 3);
    var before = row(order);
    expectError(act(order, "remind", WORKER, at(7200)), 409, "REMINDER_LIMIT_REACHED");
    assertEquals(before, row(order));
  }

  @ParameterizedTest
  @ValueSource(strings = {"PENDING", "PREPARING", "READY", "DELIVERED", "CANCELLED"})
  void onlyACalledOrderCanBeRemindedOrMarkedNotCollected(String state) throws Exception {
    UUID order = order(client(), CAFE, state, 0);
    var before = row(order);
    expectError(act(order, "remind", WORKER, at(7200)), 409, "INVALID_ORDER_STATE");
    expectError(act(order, "not-collected", WORKER, at(7200)), 409, "INVALID_ORDER_STATE");
    assertEquals(before, row(order));
  }

  // ---------------------------------------------------------------- not collected

  @Test
  void notCollectedNeedsTheThreeReminders() throws Exception {
    UUID order = order(client(), CAFE, "CALLED", 2);
    var before = row(order);
    expectError(
        act(order, "not-collected", WORKER, at(7200)), 409, "NOT_COLLECTED_REQUIREMENTS_NOT_MET");
    assertEquals(before, row(order));
  }

  @Test
  void afterTheThreeRemindersItIsNotCollectedOnceAndTheClientIsFree() throws Exception {
    UUID owner = client();
    UUID order = order(owner, CAFE, "CALLED", 3);
    act(order, "not-collected", WORKER, at(1200))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.status").value("NOT_COLLECTED"))
        .andExpect(jsonPath("$.reminderCount").value(3));
    var after = row(order);
    assertEquals("NOT_COLLECTED", after.get("status"));
    assertEquals(at(1200), ((java.sql.Timestamp) after.get("not_collected_at")).toInstant());
    expectError(act(order, "not-collected", WORKER, at(1300)), 409, "INVALID_ORDER_STATE");
    expectError(act(order, "not-collected", COWORKER, at(1300)), 409, "INVALID_ORDER_STATE");
    expectError(act(order, "remind", WORKER, at(1300)), 409, "INVALID_ORDER_STATE");
    assertEquals(after, row(order));
    // A terminal state closes it: the one-active-order index lets the client order again.
    assertDoesNotThrow(() -> order(owner, CAFE, "PENDING", 0));
  }

  // ---------------------------------------------------------------- guards

  @ParameterizedTest
  @ValueSource(strings = {"remind", "not-collected"})
  void anotherCafeteriasOrderAndAMissingOneAreTheSame403(String action) throws Exception {
    UUID foreign = order(client(), OTHER_CAFE, "CALLED", 3);
    var before = row(foreign);
    String foreignBody =
        act(foreign, action, WORKER, at(7200))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.code").value("FORBIDDEN"))
            .andReturn()
            .getResponse()
            .getContentAsString(StandardCharsets.UTF_8);
    String missingBody =
        act(UUID.randomUUID(), action, WORKER, at(7200))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.code").value("FORBIDDEN"))
            .andReturn()
            .getResponse()
            .getContentAsString(StandardCharsets.UTF_8);
    assertEquals(
        foreignBody.replaceAll("\"(timestamp|path)\":\"[^\"]*\"", ""),
        missingBody.replaceAll("\"(timestamp|path)\":\"[^\"]*\"", ""));
    assertEquals(before, row(foreign));
    // Its own worker reaches the use case.
    expectError(act(foreign, "remind", OTHER_WORKER, at(7200)), 409, "REMINDER_LIMIT_REACHED");
  }

  @ParameterizedTest
  @ValueSource(strings = {"remind", "not-collected"})
  void aClientAnAnonymousAndAForgedTokenCannotAct(String action) throws Exception {
    UUID owner = client();
    UUID order = order(owner, CAFE, "CALLED", 3);
    var before = row(order);
    expectError(act(order, action, owner, at(7200)), 403, "FORBIDDEN");
    act(order, action, null, at(7200)).andExpect(status().isUnauthorized());
    mvc.perform(
            patch("/api/orders/" + order + "/" + action)
                .header("Authorization", "Bearer forged.token.value"))
        .andExpect(status().isUnauthorized());
    assertEquals(before, row(order));
  }
}

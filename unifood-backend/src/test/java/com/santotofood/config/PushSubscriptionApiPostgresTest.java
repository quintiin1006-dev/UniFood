package com.santotofood.config;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.santotofood.adapter.in.web.OrderController;
import com.santotofood.adapter.in.web.PushSubscriptionController;
import com.santotofood.adapter.in.web.error.GlobalExceptionHandler;
import com.santotofood.adapter.in.web.error.PushSubscriptionExceptionHandler;
import com.santotofood.adapter.in.web.mapper.OrderResponseMapper;
import com.santotofood.adapter.out.persistence.AuthorizationPersistenceAdapter;
import com.santotofood.adapter.out.persistence.OrderItemPersistenceAdapter;
import com.santotofood.adapter.out.persistence.OrderPersistenceAdapter;
import com.santotofood.adapter.out.persistence.PushSubscriptionPersistenceAdapter;
import com.santotofood.adapter.out.persistence.entity.OrderEntity;
import com.santotofood.adapter.out.persistence.entity.OrderItemEntity;
import com.santotofood.adapter.out.persistence.mapper.OrderItemMapper;
import com.santotofood.adapter.out.persistence.mapper.OrderMapper;
import com.santotofood.adapter.out.persistence.repository.SpringDataOrderItemRepository;
import com.santotofood.adapter.out.persistence.repository.SpringDataOrderRepository;
import com.santotofood.adapter.out.push.PushChannelSender;
import com.santotofood.adapter.out.push.PushMessage;
import com.santotofood.adapter.out.push.PushNotificationDispatcher;
import com.santotofood.adapter.out.push.PushSettings;
import com.santotofood.application.model.PushRecipient;
import com.santotofood.application.port.out.PushSubscriptionPort;
import com.santotofood.application.service.OrderService;
import com.santotofood.application.service.PushSubscriptionService;
import com.santotofood.domain.model.OrderPushEvent;
import com.santotofood.domain.model.OrderPushEvent.Kind;
import com.santotofood.domain.port.out.OrderItemRepository;
import com.santotofood.domain.port.out.OrderRepository;
import com.santotofood.domain.port.out.PushNotificationPort;
import com.santotofood.domain.port.out.TimeProvider;
import jakarta.persistence.EntityManagerFactory;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentLinkedDeque;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import javax.sql.DataSource;
import org.junit.jupiter.api.*;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.dao.DataIntegrityViolationException;
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
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.EnableTransactionManagement;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.context.support.AnnotationConfigWebApplicationContext;
import org.springframework.web.servlet.config.annotation.EnableWebMvc;

/**
 * Migration 027, the subscription endpoints and order notices on the real schema, with a simulated
 * push service. The user always comes from the token; the role and the worker's cafeteria from the
 * database.
 */
@Timeout(180)
class PushSubscriptionApiPostgresTest {
  static final Instant NOW = Instant.parse("2026-11-20T17:00:00Z");
  static final AtomicReference<Instant> CLOCK = new AtomicReference<>(NOW);
  static final UUID CAFE = UUID.randomUUID();
  static final UUID OTHER_CAFE = UUID.randomUUID();
  static final UUID WORKER = UUID.randomUUID();
  static final UUID OTHER_WORKER = UUID.randomUUID();
  static final UUID INACTIVE_WORKER = UUID.randomUUID();
  static final AtomicInteger CODES = new AtomicInteger(5100000);
  static final AtomicInteger ENDPOINTS = new AtomicInteger();
  static final String P256DH = "B" + "A".repeat(86);
  static final String AUTH = "A".repeat(22);
  static final SimulatedPushService PUSH = new SimulatedPushService();
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
    PushConfiguration.PushIdentity pushIdentity() {
      return new PushConfiguration.PushIdentity(Optional.empty());
    }

    @Bean
    PushNotificationPort push(PushSubscriptionPort subscriptions) {
      // Synchronous executor: after the commit the notice is delivered before the response.
      return new PushNotificationDispatcher(
          subscriptions,
          List.of(PUSH),
          Runnable::run,
          PushSettings.defaults(),
          CLOCK::get,
          duration -> {});
    }

    @Bean
    OrderService orders(
        OrderRepository orders,
        OrderItemRepository items,
        TimeProvider clock,
        PushNotificationPort push) {
      return new OrderService(orders, items, clock, push);
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
        PushSubscriptionPersistenceAdapter.class,
        PushSubscriptionService.class,
        PushSubscriptionController.class,
        PushSubscriptionExceptionHandler.class,
        OrderResponseMapper.class,
        OrderController.class,
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
  void reset() {
    PUSH.reset();
    // Every test moves the clock forward: the per-minute subscription limit starts fresh.
    CLOCK.set(CLOCK.get().plusSeconds(3600));
  }

  // ---------------------------------------------------------------- fixture

  static void seed() {
    UUID site = UUID.randomUUID();
    jdbc.update(
        "INSERT INTO public.sites(id,name,city,institution_id) SELECT ?,'Sede Push','Villavicencio',id FROM public.institutions WHERE email_domain='ustavillavo.edu.co'",
        site);
    for (UUID cafe : new UUID[] {CAFE, OTHER_CAFE})
      jdbc.update(
          "INSERT INTO public.cafeterias(id,site_id,name,is_active,lunch_order_start,lunch_order_end) VALUES (?,?,?,false,'06:00','18:00')",
          cafe,
          site,
          cafe.equals(CAFE) ? "Cafetería Push" : "Cafetería Otra");
    staff(WORKER, CAFE);
    staff(OTHER_WORKER, OTHER_CAFE);
    staff(INACTIVE_WORKER, CAFE);
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

  static UUID order(UUID user, UUID cafe, String state) {
    UUID id = UUID.randomUUID();
    jdbc.update(
        "INSERT INTO public.orders(id,cafeteria_id,client_id,client_name,status,total,created_at,client_code,client_type) "
            + "SELECT ?,?,c.id,c.full_name,'PENDING',13000,?,c.institutional_code,c.client_type FROM public.clients c WHERE c.user_id=?",
        id,
        cafe,
        CLOCK.get().minusSeconds(60).atOffset(ZoneOffset.UTC),
        user);
    if (!state.equals("PENDING"))
      jdbc.update(
          "UPDATE public.orders SET status='" + state + "'::public.order_status WHERE id=?", id);
    return id;
  }

  static String endpoint() {
    return "https://fcm.googleapis.com/fcm/send/device-" + ENDPOINTS.incrementAndGet();
  }

  static String body(String endpoint) {
    return "{\"endpoint\":\""
        + endpoint
        + "\",\"keys\":{\"p256dh\":\""
        + P256DH
        + "\",\"auth\":\""
        + AUTH
        + "\"},\"userAgent\":\"Mozilla/5.0 (iPhone)\"}";
  }

  static RequestPostProcessor as(UUID subject) {
    return jwt()
        .jwt(
            token ->
                token
                    .subject(subject.toString())
                    .claim("user_metadata", Map.of("role", "WORKER", "cafeteriaId", "forged")));
  }

  static ResultActions subscribe(String path, UUID user, String body) throws Exception {
    var request = post(path).contentType(MediaType.APPLICATION_JSON).content(body);
    if (user != null) request.with(as(user));
    return mvc.perform(request);
  }

  static ResultActions unsubscribe(String path, UUID user, String body) throws Exception {
    return mvc.perform(
        delete(path).with(as(user)).contentType(MediaType.APPLICATION_JSON).content(body));
  }

  static List<Map<String, Object>> rows(UUID user) {
    return jdbc.queryForList(
        "SELECT id, role, cafeteria_id, endpoint, revoked_at FROM public.push_subscriptions WHERE user_id=? ORDER BY created_at",
        user);
  }

  static long active(UUID user) {
    return jdbc.queryForObject(
        "SELECT count(*) FROM public.push_subscriptions WHERE user_id=? AND revoked_at IS NULL",
        Long.class,
        user);
  }

  static UUID registered(UUID user, String path, String endpoint) throws Exception {
    var response =
        subscribe(path, user, body(endpoint))
            .andExpect(status().isOk())
            .andReturn()
            .getResponse()
            .getContentAsString();
    return UUID.fromString(response.replaceAll(".*\"subscriptionId\":\"([^\"]+)\".*", "$1"));
  }

  static ResultActions act(UUID order, String action, UUID worker) throws Exception {
    return mvc.perform(patch("/api/orders/" + order + "/" + action).with(as(worker)));
  }

  // ---------------------------------------------------------------- migration 027

  @Test
  void theTableIsClosedToTheBrowserWithRowLevelSecurity() {
    assertTrue(
        jdbc.queryForObject(
            "SELECT relrowsecurity FROM pg_class WHERE oid='public.push_subscriptions'::regclass",
            Boolean.class));
    for (String role : List.of("anon", "authenticated"))
      for (String privilege : List.of("SELECT", "INSERT", "UPDATE", "DELETE"))
        assertFalse(
            jdbc.queryForObject(
                "SELECT has_table_privilege(?, 'public.push_subscriptions', ?)",
                Boolean.class,
                role,
                privilege),
            role + " " + privilege);
  }

  @Test
  void theMigrationIsIdempotent() throws Exception {
    String sql =
        Files.readString(
            Path.of("supabase/migrations/027_push_subscriptions.sql"), StandardCharsets.UTF_8);
    assertDoesNotThrow(() -> jdbc.execute(sql));
    assertDoesNotThrow(() -> jdbc.execute(sql));
  }

  @Test
  void theChecksRejectInconsistentRows() {
    UUID user = client();
    String insert =
        "INSERT INTO public.push_subscriptions(user_id,role,cafeteria_id,channel,endpoint,p256dh,auth) VALUES (?,?,?,?,?,?,?)";
    assertThrows(
        DataIntegrityViolationException.class,
        () -> jdbc.update(insert, user, "CLIENT", null, "SMS", endpoint(), P256DH, AUTH));
    assertThrows(
        DataIntegrityViolationException.class,
        () -> jdbc.update(insert, user, "CLIENT", CAFE, "WEB_PUSH", endpoint(), P256DH, AUTH));
    assertThrows(
        DataIntegrityViolationException.class,
        () -> jdbc.update(insert, user, "WORKER", null, "WEB_PUSH", endpoint(), P256DH, AUTH));
    assertThrows(
        DataIntegrityViolationException.class,
        () -> jdbc.update(insert, user, "ADMIN", null, "WEB_PUSH", endpoint(), P256DH, AUTH));
    assertThrows(
        DataIntegrityViolationException.class,
        () ->
            jdbc.update(
                insert, user, "CLIENT", null, "WEB_PUSH", "http://insecure/x", P256DH, AUTH));
    assertThrows(
        DataIntegrityViolationException.class,
        () -> jdbc.update(insert, user, "CLIENT", null, "WEB_PUSH", endpoint(), null, null));
    assertThrows(
        DataIntegrityViolationException.class,
        () ->
            jdbc.update(
                insert,
                user,
                "CLIENT",
                null,
                "WEB_PUSH",
                "https://fcm.googleapis.com/" + "x".repeat(2100),
                P256DH,
                AUTH));
    // A future native app fits the same structure: a token and no Web Push keys.
    assertEquals(1, jdbc.update(insert, user, "CLIENT", null, "FCM", "fcm-token-1", null, null));
  }

  // ---------------------------------------------------------------- endpoints

  @Test
  void aClientRegistersAsTheTokenUserNeverAsTheUserOfTheBody() throws Exception {
    UUID user = client();
    UUID victim = client();
    String forged =
        body(endpoint()).replace("{\"endpoint\"", "{\"userId\":\"" + victim + "\",\"endpoint\"");
    subscribe("/api/me/push/subscribe", user, forged)
        .andExpect(status().isOk())
        .andExpect(header().string("Cache-Control", "no-store"))
        .andExpect(jsonPath("$.subscriptionId").isString());
    var rows = rows(user);
    assertEquals(1, rows.size());
    assertEquals("CLIENT", rows.getFirst().get("role"));
    assertNull(rows.getFirst().get("cafeteria_id"));
    assertTrue(rows(victim).isEmpty());
  }

  @Test
  void aWorkerRegistersWithTheCafeteriaOfTheDatabaseNotTheForgedClaim() throws Exception {
    registered(WORKER, "/api/worker/push/subscribe", endpoint());
    assertEquals(CAFE, rows(WORKER).getLast().get("cafeteria_id"));
    assertEquals("WORKER", rows(WORKER).getLast().get("role"));
  }

  @Test
  void eachRoleUsesOnlyItsOwnRoute() throws Exception {
    UUID user = client();
    subscribe("/api/worker/push/subscribe", user, body(endpoint()))
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.code").value("PUSH_FORBIDDEN"));
    subscribe("/api/me/push/subscribe", OTHER_WORKER, body(endpoint()))
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.code").value("PUSH_FORBIDDEN"));
    subscribe("/api/me/push/subscribe", null, body(endpoint()))
        .andExpect(status().isUnauthorized());
    assertTrue(rows(user).isEmpty());
  }

  @Test
  void invalidBodiesAreRefusedWithoutEchoingThem() throws Exception {
    UUID user = client();
    for (String bad :
        List.of(
            "{}",
            "not json",
            body("https://evil.example/collect"),
            body(endpoint()).replace(P256DH, "short")))
      subscribe("/api/me/push/subscribe", user, bad)
          .andExpect(status().isBadRequest())
          .andExpect(jsonPath("$.code").value("PUSH_SUBSCRIPTION_INVALID"))
          .andExpect(
              content()
                  .string(org.hamcrest.Matchers.not(org.hamcrest.Matchers.containsString("evil"))));
    assertTrue(rows(user).isEmpty());
  }

  @Test
  void theSixthDeviceRevokesTheOldestAndFiveStayActive() throws Exception {
    UUID user = client();
    List<String> endpoints = new ArrayList<>();
    for (int i = 0; i < 6; i++) {
      String endpoint = endpoint();
      endpoints.add(endpoint);
      registered(user, "/api/me/push/subscribe", endpoint);
      CLOCK.set(CLOCK.get().plusSeconds(1));
      jdbc.update(
          "UPDATE public.push_subscriptions SET last_seen_at = last_seen_at + make_interval(secs => ?) WHERE endpoint=?",
          i,
          endpoint);
    }
    assertEquals(5, active(user));
    var oldest =
        jdbc.queryForObject(
            "SELECT revoked_at IS NOT NULL FROM public.push_subscriptions WHERE endpoint=?",
            Boolean.class,
            endpoints.getFirst());
    assertTrue(oldest);
  }

  @Test
  void registeringAgainReactivatesTheSameRow() throws Exception {
    UUID user = client();
    String endpoint = endpoint();
    UUID first = registered(user, "/api/me/push/subscribe", endpoint);
    unsubscribe("/api/me/push/subscribe", user, "{\"endpoint\":\"" + endpoint + "\"}")
        .andExpect(status().isNoContent());
    assertEquals(0, active(user));
    assertEquals(first, registered(user, "/api/me/push/subscribe", endpoint));
    assertEquals(1, active(user));
  }

  @Test
  void aSharedBrowserMovesTheEndpointToTheAccountThatRegisteredLast() throws Exception {
    UUID first = client();
    UUID second = client();
    String endpoint = endpoint();
    registered(first, "/api/me/push/subscribe", endpoint);
    registered(second, "/api/me/push/subscribe", endpoint);
    assertEquals(0, active(first));
    assertEquals(1, active(second));
  }

  @Test
  void signOutRevokesOnlyTheCallersOwnDevice() throws Exception {
    UUID owner = client();
    UUID other = client();
    String endpoint = endpoint();
    UUID id = registered(owner, "/api/me/push/subscribe", endpoint);
    // Another account cannot revoke it, by endpoint or by id; the answer is the same 204.
    unsubscribe("/api/me/push/subscribe", other, "{\"endpoint\":\"" + endpoint + "\"}")
        .andExpect(status().isNoContent());
    unsubscribe("/api/me/push/subscribe", other, "{\"subscriptionId\":\"" + id + "\"}")
        .andExpect(status().isNoContent());
    assertEquals(1, active(owner));
    // The owner's sign-out (the web server sends the id from its httpOnly cookie) revokes it.
    unsubscribe("/api/me/push/subscribe", owner, "{\"subscriptionId\":\"" + id + "\"}")
        .andExpect(status().isNoContent());
    assertEquals(0, active(owner));
    unsubscribe("/api/me/push/subscribe", owner, "{}")
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("PUSH_SUBSCRIPTION_INVALID"));
  }

  @Test
  void aWorkerSignsOutThroughItsRouteToo() throws Exception {
    String endpoint = endpoint();
    UUID id = registered(WORKER, "/api/worker/push/subscribe", endpoint);
    unsubscribe("/api/worker/push/subscribe", WORKER, "{\"subscriptionId\":\"" + id + "\"}")
        .andExpect(status().isNoContent());
    assertNotNull(
        jdbc.queryForObject(
            "SELECT revoked_at FROM public.push_subscriptions WHERE id=?", Instant.class, id));
  }

  @Test
  void theSubscriptionEndpointsAreRateLimitedPerUser() throws Exception {
    UUID user = client();
    for (int i = 0; i < PushSubscriptionService.REQUESTS_PER_MINUTE; i++)
      subscribe("/api/me/push/subscribe", user, body(endpoint())).andExpect(status().isOk());
    subscribe("/api/me/push/subscribe", user, body(endpoint()))
        .andExpect(status().isTooManyRequests())
        .andExpect(header().string("Retry-After", "60"))
        .andExpect(jsonPath("$.code").value("PUSH_RATE_LIMITED"));
    // Another user is not affected.
    subscribe("/api/me/push/subscribe", client(), body(endpoint())).andExpect(status().isOk());
  }

  @Test
  void withoutVapidThePublicKeyAnswersThatPushIsDisabled() throws Exception {
    mvc.perform(get("/api/me/push/public-key").with(as(client())))
        .andExpect(status().isServiceUnavailable())
        .andExpect(jsonPath("$.code").value("PUSH_DISABLED"));
  }

  // ---------------------------------------------------------------- notices

  @Test
  void aTransitionIsCommittedAndThenNotifiesOnlyTheOrdersClient() throws Exception {
    UUID owner = client();
    UUID stranger = client();
    String ownerEndpoint = endpoint();
    registered(owner, "/api/me/push/subscribe", ownerEndpoint);
    registered(stranger, "/api/me/push/subscribe", endpoint());
    UUID order = order(owner, CAFE, "PREPARING");
    act(order, "ready", WORKER).andExpect(status().isOk());
    assertEquals("READY", orderStatus(order));
    assertEquals(List.of(ownerEndpoint), PUSH.endpoints());
    assertEquals("¡Tu pedido está listo!", PUSH.messages().getFirst().title());
  }

  @Test
  void aNewOrderNotifiesOnlyActiveWorkersOfItsCafeteria() throws Exception {
    String workerEndpoint = endpoint();
    registered(WORKER, "/api/worker/push/subscribe", workerEndpoint);
    registered(OTHER_WORKER, "/api/worker/push/subscribe", endpoint());
    registered(INACTIVE_WORKER, "/api/worker/push/subscribe", endpoint());
    jdbc.update("UPDATE public.users SET is_active=false WHERE id=?", INACTIVE_WORKER);
    try {
      UUID order = order(client(), CAFE, "PENDING");
      context.getBean(PushNotificationPort.class).publish(OrderPushEvent.of(order, Kind.NEW_ORDER));
      assertEquals(List.of(workerEndpoint), PUSH.endpoints());
    } finally {
      jdbc.update("UPDATE public.users SET is_active=true WHERE id=?", INACTIVE_WORKER);
    }
  }

  @Test
  void aWorkerMovedToAnotherCafeteriaStopsReceivingTheOldOne() throws Exception {
    UUID moved = UUID.randomUUID();
    staff(moved, CAFE);
    registered(moved, "/api/worker/push/subscribe", endpoint());
    jdbc.update(
        "UPDATE public.cafeteria_users SET cafeteria_id=? WHERE user_id=?", OTHER_CAFE, moved);
    UUID order = order(client(), CAFE, "PENDING");
    context.getBean(PushNotificationPort.class).publish(OrderPushEvent.of(order, Kind.NEW_ORDER));
    assertTrue(
        PUSH.endpoints().stream()
            .noneMatch(e -> rows(moved).stream().anyMatch(r -> e.equals(r.get("endpoint")))));
  }

  @Test
  void aFailingPushNeverRevertsNorBlocksTheTransition() throws Exception {
    UUID owner = client();
    registered(owner, "/api/me/push/subscribe", endpoint());
    for (var failure :
        List.of(PushChannelSender.Result.RETRYABLE, PushChannelSender.Result.REJECTED)) {
      PUSH.reset();
      PUSH.always = failure;
      UUID order = order(owner, CAFE, "PREPARING");
      act(order, "ready", WORKER).andExpect(status().isOk());
      assertEquals("READY", orderStatus(order));
      jdbc.update(
          "UPDATE public.orders SET status='DELIVERED', called_at=now(), delivered_at=now() WHERE id=?",
          order);
    }
    PUSH.reset();
    PUSH.explode = true;
    UUID order = order(owner, CAFE, "PREPARING");
    act(order, "ready", WORKER).andExpect(status().isOk());
    assertEquals("READY", orderStatus(order));
  }

  @Test
  void a410FromThePushServiceRevokesTheSubscription() throws Exception {
    UUID owner = client();
    String endpoint = endpoint();
    registered(owner, "/api/me/push/subscribe", endpoint);
    PUSH.always = PushChannelSender.Result.GONE;
    UUID order = order(owner, CAFE, "PREPARING");
    act(order, "ready", WORKER).andExpect(status().isOk());
    assertEquals(0, active(owner));
  }

  @Test
  void aRolledBackTransactionSendsNothing() throws Exception {
    UUID owner = client();
    registered(owner, "/api/me/push/subscribe", endpoint());
    UUID order = order(owner, CAFE, "PREPARING");
    var tx = new TransactionTemplate(context.getBean(PlatformTransactionManager.class));
    tx.executeWithoutResult(
        status -> {
          context
              .getBean(com.santotofood.application.port.in.MarkOrderReadyUseCase.class)
              .markOrderReady(order);
          status.setRollbackOnly();
        });
    assertEquals("PREPARING", orderStatus(order));
    assertTrue(PUSH.endpoints().isEmpty());
  }

  @Test
  void aRejectedOrderIsNotifiedButTheRejectionReasonIsNotInThePayload() throws Exception {
    UUID owner = client();
    registered(owner, "/api/me/push/subscribe", endpoint());
    UUID order = order(owner, CAFE, "PENDING");
    mvc.perform(
            patch("/api/orders/" + order + "/reject")
                .with(as(WORKER))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"reason\":\"Se acabó el pollo de Ana\"}"))
        .andExpect(status().isOk());
    var message = PUSH.messages().getFirst();
    assertEquals("La cafetería no pudo aceptar tu pedido", message.title());
    assertFalse(message.json().contains("pollo"));
    assertFalse(message.json().contains("Ana"));
  }

  static String orderStatus(UUID order) {
    return jdbc.queryForObject(
        "SELECT status::text FROM public.orders WHERE id=?", String.class, order);
  }

  /** A push service that answers what the test scripts and records every attempt. */
  static final class SimulatedPushService implements PushChannelSender {
    final ConcurrentLinkedDeque<PushRecipient> recipients = new ConcurrentLinkedDeque<>();
    final List<PushMessage> sent = Collections.synchronizedList(new ArrayList<>());
    volatile Result always = Result.DELIVERED;
    volatile boolean explode;

    void reset() {
      recipients.clear();
      sent.clear();
      always = Result.DELIVERED;
      explode = false;
    }

    List<String> endpoints() {
      return recipients.stream().map(PushRecipient::endpoint).distinct().toList();
    }

    List<PushMessage> messages() {
      return List.copyOf(sent);
    }

    @Override
    public String channel() {
      return "WEB_PUSH";
    }

    @Override
    public Result send(PushRecipient recipient, PushMessage message) {
      recipients.add(recipient);
      sent.add(message);
      if (explode) throw new IllegalStateException("simulated crash");
      return always;
    }
  }
}

package com.santotofood.config;

import static org.hamcrest.Matchers.hasSize;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.santotofood.adapter.in.web.OrderNoticeController;
import com.santotofood.adapter.in.web.error.GlobalExceptionHandler;
import com.santotofood.adapter.in.web.error.OrderNoticeExceptionHandler;
import com.santotofood.adapter.out.persistence.AuthorizationPersistenceAdapter;
import com.santotofood.adapter.out.persistence.OrderNoticePersistenceAdapter;
import com.santotofood.application.model.OrderNoticeKind;
import com.santotofood.application.port.out.OrderNoticesFlag;
import com.santotofood.application.service.OrderNoticeRecorder;
import com.santotofood.application.service.OrderNoticeService;
import com.santotofood.domain.port.out.TimeProvider;
import jakarta.persistence.EntityManagerFactory;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import javax.sql.DataSource;
import org.junit.jupiter.api.*;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.mock.web.MockServletContext;
import org.springframework.orm.jpa.JpaTransactionManager;
import org.springframework.orm.jpa.LocalContainerEntityManagerFactoryBean;
import org.springframework.orm.jpa.persistenceunit.PersistenceManagedTypes;
import org.springframework.orm.jpa.vendor.HibernateJpaVendorAdapter;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.jwt.BadJwtException;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.transaction.annotation.EnableTransactionManagement;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.context.support.AnnotationConfigWebApplicationContext;
import org.springframework.web.servlet.config.annotation.EnableWebMvc;

/**
 * Migration 034, the JDBC adapter and the /api/me/notices endpoints against an isolated PostgreSQL:
 * only the caller's own notices, the 7-day and 20-notice window, idempotent reads, the flag,
 * duplicate events and the savepoint that keeps the order transition alive.
 */
@Timeout(90)
class OrderNoticesApiPostgresTest {
  static final Instant NOW = Instant.now().truncatedTo(ChronoUnit.SECONDS);
  static final AtomicInteger CODES = new AtomicInteger(9100);
  static final UUID CAFE_A = UUID.randomUUID();
  static final UUID CAFE_B = UUID.randomUUID();
  static volatile boolean enabled = true;

  static Process database;
  static AnnotationConfigWebApplicationContext context;
  static JdbcTemplate jdbc;
  static MockMvc mvc;
  static OrderNoticePersistenceAdapter adapter;
  static OrderNoticeRecorder service;
  static TransactionTemplate transactions;

  static UUID ana, beto, carol, dora, worker;
  static UUID anaCalled, anaDelivered, betoOrder, carolOrder, doraOrder;

  @Configuration
  @EnableWebMvc
  @EnableTransactionManagement
  static class TestConfig {
    static DataSource source;

    @Bean
    DataSource dataSource() {
      return source;
    }

    @Bean
    JdbcTemplate jdbc(DataSource dataSource) {
      return new JdbcTemplate(dataSource);
    }

    @Bean
    TimeProvider timeProvider() {
      return () -> NOW;
    }

    @Bean
    OrderNoticesFlag orderNoticesFlag() {
      return () -> enabled;
    }

    @Bean
    LocalContainerEntityManagerFactoryBean entityManagerFactory(DataSource dataSource) {
      var factory = new LocalContainerEntityManagerFactoryBean();
      factory.setDataSource(dataSource);
      factory.setJpaVendorAdapter(new HibernateJpaVendorAdapter());
      // Production's transaction manager, so the savepoint test shares JPA's JDBC connection.
      factory.setManagedTypes(PersistenceManagedTypes.of());
      factory.setJpaPropertyMap(Map.of("hibernate.hbm2ddl.auto", "none"));
      return factory;
    }

    @Bean
    JpaTransactionManager transactionManager(EntityManagerFactory entityManagerFactory) {
      return new JpaTransactionManager(entityManagerFactory);
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
    TestConfig.source = new DriverManagerDataSource(url, "postgres", "");
    jdbc = new JdbcTemplate(TestConfig.source);
    context = new AnnotationConfigWebApplicationContext();
    context.setServletContext(new MockServletContext());
    context.register(
        TestConfig.class,
        SecurityConfig.class,
        OrderAuthorization.class,
        AuthorizationPersistenceAdapter.class,
        OrderNoticePersistenceAdapter.class,
        OrderNoticeService.class,
        OrderNoticeController.class,
        OrderNoticeExceptionHandler.class,
        GlobalExceptionHandler.class);
    context.refresh();
    mvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
    adapter = context.getBean(OrderNoticePersistenceAdapter.class);
    service = context.getBean(OrderNoticeRecorder.class);
    transactions = new TransactionTemplate(context.getBean(JpaTransactionManager.class));
    seed();
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

  @AfterEach
  void flagBackOn() {
    enabled = true;
  }

  static UUID client() {
    UUID id = UUID.randomUUID();
    jdbc.update("INSERT INTO auth.users(id,email) VALUES (?, ?)", id, id + "@ustavillavo.edu.co");
    jdbc.update(
        "INSERT INTO public.clients(user_id,full_name,institution_id,client_type,institutional_code) "
            + "SELECT ?,'Cliente de prueba',id,'STUDENT',? FROM public.institutions WHERE email_domain='ustavillavo.edu.co'",
        id,
        String.valueOf(CODES.incrementAndGet()));
    jdbc.update(
        "INSERT INTO public.user_roles(user_id,role_id) SELECT ?,id FROM public.roles WHERE name::text='CLIENT'",
        id);
    jdbc.update("UPDATE public.users SET is_active=true WHERE id=?", id);
    return id;
  }

  static UUID order(UUID user, UUID cafeteria) {
    UUID id = UUID.randomUUID();
    jdbc.update(
        "INSERT INTO public.orders(id,cafeteria_id,client_id,client_name,status,total,created_at,client_code,client_type) "
            + "SELECT ?,?,c.id,c.full_name,'PENDING',13000,?,c.institutional_code,c.client_type FROM public.clients c WHERE c.user_id=?",
        id,
        cafeteria,
        NOW.minus(Duration.ofHours(1)).atOffset(ZoneOffset.UTC),
        user);
    return id;
  }

  static void notice(UUID order, OrderNoticeKind kind, int sequence, Duration ago) {
    adapter.record(order, kind, sequence, NOW.minus(ago));
  }

  static void seed() {
    UUID site = UUID.randomUUID();
    jdbc.update(
        "INSERT INTO public.sites(id,name,city,institution_id) SELECT ?,'Sede avisos','Villavicencio',id FROM public.institutions WHERE email_domain='ustavillavo.edu.co'",
        site);
    for (UUID cafe : new UUID[] {CAFE_A, CAFE_B})
      jdbc.update(
          "INSERT INTO public.cafeterias(id,site_id,name,is_active,lunch_order_start,lunch_order_end) VALUES (?,?,?,false,'06:00','18:00')",
          cafe,
          site,
          "Cafetería avisos " + cafe);
    worker = UUID.randomUUID();
    jdbc.update(
        "INSERT INTO auth.users(id,email) VALUES (?, ?)", worker, worker + "@example.invalid");
    jdbc.update(
        "INSERT INTO public.user_roles(user_id,role_id) SELECT ?,id FROM public.roles WHERE name::text='WORKER'",
        worker);
    jdbc.update(
        "INSERT INTO public.cafeteria_users(user_id,cafeteria_id) VALUES (?,?)", worker, CAFE_A);
    jdbc.update("UPDATE public.users SET is_active=true WHERE id=?", worker);

    ana = client();
    beto = client();
    carol = client();
    dora = client();
    anaDelivered = order(ana, CAFE_B);
    jdbc.update(
        "UPDATE public.orders SET status='DELIVERED', called_at=?, delivered_at=? WHERE id=?",
        NOW.minus(Duration.ofDays(2)).atOffset(ZoneOffset.UTC),
        NOW.minus(Duration.ofDays(2)).atOffset(ZoneOffset.UTC),
        anaDelivered);
    anaCalled = order(ana, CAFE_A);
    betoOrder = order(beto, CAFE_A);
    carolOrder = order(carol, CAFE_A);
    doraOrder = order(dora, CAFE_B);

    notice(anaDelivered, OrderNoticeKind.PREPARING, 0, Duration.ofDays(2));
    notice(anaDelivered, OrderNoticeKind.DELIVERED, 0, Duration.ofDays(2).minusMinutes(30));
    notice(anaDelivered, OrderNoticeKind.READY, 0, Duration.ofDays(8)); // outside the window
    notice(anaCalled, OrderNoticeKind.CALLED, 0, Duration.ofMinutes(20));
    notice(anaCalled, OrderNoticeKind.REMINDER, 1, Duration.ofMinutes(10));
    notice(anaCalled, OrderNoticeKind.REMINDER, 2, Duration.ofMinutes(5));
    notice(betoOrder, OrderNoticeKind.REJECTED, 0, Duration.ofMinutes(1));
    for (int i = 1; i <= 25; i++)
      notice(carolOrder, OrderNoticeKind.REMINDER, i, Duration.ofMinutes(60 - i));
    notice(doraOrder, OrderNoticeKind.CANCELLED_BY_CLIENT, 0, Duration.ofMinutes(3));

    jdbc.update(
        "UPDATE public.orders SET status='CALLED', called_at=? WHERE id=?",
        NOW.minus(Duration.ofMinutes(20)).atOffset(ZoneOffset.UTC),
        anaCalled);
  }

  static RequestPostProcessor as(UUID subject) {
    return jwt()
        .jwt(
            token ->
                token
                    .subject(subject.toString())
                    .claim("role", "CLIENT")
                    .claim("userId", beto.toString()))
        .authorities(new SimpleGrantedAuthority("ROLE_CLIENT"));
  }

  static int count(String where, Object... args) {
    return jdbc.queryForObject(
        "SELECT count(*) FROM public.order_notices WHERE " + where, Integer.class, args);
  }

  @Test
  void aClientReadsOnlyItsOwnNoticesNewestFirstWithBothRemindersDespiteForgedIds()
      throws Exception {
    mvc.perform(
            get("/api/me/notices")
                .with(as(ana))
                .queryParam("userId", beto.toString())
                .queryParam("cafeteriaId", CAFE_A.toString()))
        .andExpect(status().isOk())
        .andExpect(header().string("Cache-Control", "no-store"))
        .andExpect(jsonPath("$.notices", hasSize(5)))
        .andExpect(jsonPath("$.unread").value(5))
        .andExpect(jsonPath("$.notices[0].kind").value("REMINDER"))
        .andExpect(jsonPath("$.notices[0].sequence").value(2))
        .andExpect(jsonPath("$.notices[0].orderId").value(anaCalled.toString()))
        .andExpect(jsonPath("$.notices[0].orderActive").value(true))
        .andExpect(jsonPath("$.notices[0].read").value(false))
        .andExpect(jsonPath("$.notices[1].kind").value("REMINDER"))
        .andExpect(jsonPath("$.notices[1].sequence").value(1))
        .andExpect(jsonPath("$.notices[2].kind").value("CALLED"))
        .andExpect(jsonPath("$.notices[3].kind").value("DELIVERED"))
        .andExpect(jsonPath("$.notices[3].orderActive").value(false))
        .andExpect(jsonPath("$.notices[4].kind").value("PREPARING"))
        .andExpect(jsonPath("$.notices[0].userId").doesNotExist())
        .andExpect(jsonPath("$.notices[0].cafeteriaId").doesNotExist());
  }

  @Test
  void theInboxIsCappedAtTwentyNotices() throws Exception {
    mvc.perform(get("/api/me/notices").with(as(carol)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.notices", hasSize(20)))
        .andExpect(jsonPath("$.notices[0].sequence").value(25))
        .andExpect(jsonPath("$.notices[19].sequence").value(6));
  }

  @Test
  void anotherClientNeitherSeesNorMarksSomeoneElsesNotices() throws Exception {
    mvc.perform(get("/api/me/notices").with(as(beto)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.notices", hasSize(1)))
        .andExpect(jsonPath("$.notices[0].orderId").value(betoOrder.toString()));
    mvc.perform(post("/api/me/notices/read").with(as(beto)))
        .andExpect(status().isOk())
        .andExpect(header().string("Cache-Control", "no-store"));
    assertEquals(0, count("user_id=? AND read_at IS NULL", beto));
    assertEquals(6, count("user_id=? AND read_at IS NULL", ana));
  }

  @Test
  void markingAsReadIsIdempotentAndAnswers200Again() throws Exception {
    for (int i = 0; i < 2; i++)
      mvc.perform(post("/api/me/notices/read").with(as(dora)))
          .andExpect(status().isOk())
          .andExpect(jsonPath("$.unread").value(0));
    mvc.perform(get("/api/me/notices").with(as(dora)))
        .andExpect(jsonPath("$.unread").value(0))
        .andExpect(jsonPath("$.notices[0].kind").value("CANCELLED_BY_CLIENT"))
        .andExpect(jsonPath("$.notices[0].read").value(true));
  }

  @Test
  void aWorkerOfTheCafeteriaAndAnonymousCallersAreRefused() throws Exception {
    mvc.perform(get("/api/me/notices").with(as(worker)))
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.code").value("ORDER_NOTICES_FORBIDDEN"))
        .andExpect(jsonPath("$.notices").doesNotExist());
    mvc.perform(post("/api/me/notices/read").with(as(worker))).andExpect(status().isForbidden());
    mvc.perform(get("/api/me/notices")).andExpect(status().isUnauthorized());
    mvc.perform(post("/api/me/notices/read")).andExpect(status().isUnauthorized());
    assertEquals(0, count("user_id=?", worker));
  }

  @Test
  void flagOffAnswers404AndWritesNothing() throws Exception {
    enabled = false;
    mvc.perform(get("/api/me/notices").with(as(ana)))
        .andExpect(status().isNotFound())
        .andExpect(header().string("Cache-Control", "no-store"))
        .andExpect(jsonPath("$.code").value("ORDER_NOTICES_DISABLED"));
    mvc.perform(post("/api/me/notices/read").with(as(ana))).andExpect(status().isNotFound());
    service.record(anaCalled, OrderNoticeKind.REMINDER, 3, NOW);
    assertEquals(0, count("order_id=? AND sequence=3", anaCalled));
    assertEquals(6, count("user_id=? AND read_at IS NULL", ana));
  }

  @Test
  void aRepeatedEventIsIgnoredAndAnOrderWithoutClientStoresNothing() {
    UUID order = order(client(), CAFE_A);
    adapter.record(order, OrderNoticeKind.READY, 0, NOW);
    adapter.record(order, OrderNoticeKind.READY, 0, NOW.plusSeconds(5));
    assertEquals(1, count("order_id=?", order));
    jdbc.update("UPDATE public.orders SET client_id=NULL WHERE id=?", order);
    adapter.record(order, OrderNoticeKind.CALLED, 0, NOW);
    adapter.record(UUID.randomUUID(), OrderNoticeKind.CALLED, 0, NOW);
    assertEquals(1, count("order_id=?", order));
  }

  @Test
  void aFailedNoticeInsideTheTransitionTransactionDoesNotAbortIt() {
    UUID order = order(client(), CAFE_A);
    transactions.executeWithoutResult(
        status -> {
          jdbc.update("UPDATE public.orders SET status='PREPARING' WHERE id=?", order);
          // REMINDER with sequence 0 violates chk_order_notices_sequence.
          assertThrows(
              DataAccessException.class,
              () -> adapter.record(order, OrderNoticeKind.REMINDER, 0, NOW));
          service.record(order, OrderNoticeKind.REMINDER, 0, NOW); // swallowed by the service
          adapter.record(order, OrderNoticeKind.PREPARING, 0, NOW);
        });
    assertEquals(
        "PREPARING",
        jdbc.queryForObject(
            "SELECT status::text FROM public.orders WHERE id=?", String.class, order));
    assertEquals(1, count("order_id=? AND kind='PREPARING'", order));
    assertEquals(0, count("order_id=? AND kind='REMINDER'", order));
  }

  @Test
  void theTableIsClosedToTheBrowserRoles() {
    assertTrue(
        jdbc.queryForObject(
            "SELECT relrowsecurity FROM pg_class WHERE oid='public.order_notices'::regclass",
            Boolean.class));
    for (String role : new String[] {"anon", "authenticated"})
      for (String privilege : new String[] {"SELECT", "INSERT", "UPDATE", "DELETE"})
        assertFalse(
            jdbc.queryForObject(
                "SELECT has_table_privilege(?,'public.order_notices',?)",
                Boolean.class,
                role,
                privilege),
            role + " " + privilege);
  }
}

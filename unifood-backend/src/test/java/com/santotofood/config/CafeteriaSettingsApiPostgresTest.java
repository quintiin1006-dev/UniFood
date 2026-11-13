package com.santotofood.config;

import static org.hamcrest.Matchers.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.santotofood.adapter.in.web.ClientOrderController;
import com.santotofood.adapter.in.web.OrderController;
import com.santotofood.adapter.in.web.SuperAdminCafeteriaController;
import com.santotofood.adapter.in.web.error.ClientOrderExceptionHandler;
import com.santotofood.adapter.in.web.error.GlobalExceptionHandler;
import com.santotofood.adapter.in.web.error.SuperAdminExceptionHandler;
import com.santotofood.adapter.in.web.mapper.OrderResponseMapper;
import com.santotofood.adapter.out.persistence.AuthorizationPersistenceAdapter;
import com.santotofood.adapter.out.persistence.CafeteriaSettingsPersistenceAdapter;
import com.santotofood.adapter.out.persistence.ClientOrderPersistenceAdapter;
import com.santotofood.adapter.out.persistence.OrderItemPersistenceAdapter;
import com.santotofood.adapter.out.persistence.OrderPersistenceAdapter;
import com.santotofood.adapter.out.persistence.SuperAdminCafeteriaPersistenceAdapter;
import com.santotofood.adapter.out.persistence.entity.OrderEntity;
import com.santotofood.adapter.out.persistence.entity.OrderItemEntity;
import com.santotofood.adapter.out.persistence.mapper.OrderItemMapper;
import com.santotofood.adapter.out.persistence.mapper.OrderMapper;
import com.santotofood.adapter.out.persistence.repository.SpringDataOrderItemRepository;
import com.santotofood.adapter.out.persistence.repository.SpringDataOrderRepository;
import com.santotofood.application.port.in.GetOwnCurrentOrderUseCase;
import com.santotofood.application.port.in.GetOwnOrderHistoryUseCase;
import com.santotofood.application.port.in.GetOwnOrderUseCase;
import com.santotofood.application.service.CafeteriaSettingsService;
import com.santotofood.application.service.ClientOrderCreationService;
import com.santotofood.application.service.OrderService;
import com.santotofood.application.service.SuperAdminCafeteriaService;
import com.santotofood.domain.model.BusinessDate;
import com.santotofood.domain.port.out.OrderItemRepository;
import com.santotofood.domain.port.out.OrderRepository;
import com.santotofood.domain.port.out.TimeProvider;
import jakarta.persistence.EntityManagerFactory;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.time.Instant;
import java.time.OffsetDateTime;
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
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.jwt.BadJwtException;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.transaction.annotation.EnableTransactionManagement;
import org.springframework.web.context.support.AnnotationConfigWebApplicationContext;
import org.springframework.web.servlet.config.annotation.EnableWebMvc;

/**
 * Visibility, billing and their audit on the real schema (022): roles come from PostgreSQL, the
 * audit row is written by trigger in the same transaction, and hiding a cafeteria only stops new
 * orders while the ones in progress keep being served.
 */
@Timeout(180)
class CafeteriaSettingsApiPostgresTest {
  // Noon in America/Bogota.
  static final Instant NOW = Instant.parse("2026-11-20T17:00:00Z");
  static final String ROOT = "/api/super-admin/cafeterias/";
  static final UUID SITE = UUID.randomUUID();
  static final UUID CENTRAL = UUID.randomUUID(), NORTE = UUID.randomUUID();
  static final UUID SUR = UUID.randomUUID(), TRAP = UUID.randomUUID();
  static final UUID PRODUCT = UUID.randomUUID();
  static final UUID SUPER = UUID.randomUUID(), OTHER_SUPER = UUID.randomUUID();
  static final UUID ADMIN = UUID.randomUUID(), WORKER = UUID.randomUUID();
  static final AtomicInteger CODES = new AtomicInteger(5000000);
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
        SuperAdminCafeteriaPersistenceAdapter.class,
        SuperAdminCafeteriaService.class,
        CafeteriaSettingsPersistenceAdapter.class,
        CafeteriaSettingsService.class,
        SuperAdminCafeteriaController.class,
        SuperAdminExceptionHandler.class,
        ClientOrderPersistenceAdapter.class,
        ClientOrderCreationService.class,
        OrderResponseMapper.class,
        ClientOrderController.class,
        ClientOrderExceptionHandler.class,
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

  // ---------------------------------------------------------------- fixture

  interface Work {
    void run(JdbcTemplate tx);
  }

  static void inTransaction(Work work) {
    jdbc.execute(
        (Connection connection) -> {
          connection.setAutoCommit(false);
          work.run(new JdbcTemplate(new SingleConnectionDataSource(connection, true)));
          connection.commit();
          connection.setAutoCommit(true);
          return null;
        });
  }

  static void user(JdbcTemplate tx, UUID id, String role, UUID cafeteria, String fullName) {
    tx.update(
        "INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES (?, ?, ?::jsonb)",
        id,
        id + "@example.invalid",
        fullName == null ? "{}" : "{\"full_name\":\"" + fullName + "\"}");
    tx.update(
        "INSERT INTO public.user_roles(user_id,role_id) SELECT ?,id FROM public.roles WHERE name::text=?",
        id,
        role);
    if (cafeteria != null)
      tx.update(
          "INSERT INTO public.cafeteria_users(user_id,cafeteria_id) VALUES (?,?)", id, cafeteria);
    tx.update("UPDATE public.users SET is_active=true WHERE id=?", id);
  }

  static void cafeteria(UUID id, String name) {
    jdbc.update(
        "INSERT INTO public.cafeterias(id,site_id,name,is_active,lunch_order_start,lunch_order_end) VALUES (?,?,?,false,'06:00','18:00')",
        id,
        SITE,
        name);
  }

  static void seed() {
    jdbc.update(
        "INSERT INTO public.sites(id,name,city,institution_id) SELECT ?,'Sede Principal','Villavicencio',id FROM public.institutions WHERE email_domain='ustavillavo.edu.co'",
        SITE);
    cafeteria(CENTRAL, "Cafetería Central");
    cafeteria(NORTE, "Cafetería Norte");
    cafeteria(SUR, "Cafetería Sur");
    cafeteria(TRAP, "Cafetería Trampa");
    inTransaction(
        tx -> {
          user(tx, ADMIN, "ADMIN", CENTRAL, null);
          tx.update("UPDATE public.cafeterias SET is_active=true WHERE id=?", CENTRAL);
        });
    inTransaction(tx -> user(tx, WORKER, "WORKER", CENTRAL, null));
    inTransaction(tx -> user(tx, SUPER, "SUPER_ADMIN", null, "Dueño del repositorio"));
    inTransaction(tx -> user(tx, OTHER_SUPER, "SUPER_ADMIN", null, null));
    String today = BusinessDate.from(NOW).value().toString();
    jdbc.update(
        "INSERT INTO public.lunches(id,cafeteria_id,name,price,category) VALUES (?,?,'Corriente',13000,'CORRIENTE')",
        PRODUCT,
        CENTRAL);
    jdbc.update(
        "INSERT INTO public.cafeteria_daily_states(cafeteria_id,business_date,is_open) VALUES (?,?::date,true)",
        CENTRAL,
        today);
    jdbc.update(
        "INSERT INTO public.daily_item_availability(cafeteria_id,item_id,business_date,is_available) VALUES (?,?,?::date,true)",
        CENTRAL,
        PRODUCT,
        today);
    // Same-transaction probe: an audit row for this amount fails, and must take the change along.
    jdbc.execute(
        "CREATE FUNCTION public.test_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ "
            + "BEGIN IF NEW.new_value ->> 'subscriptionFeeCop' = '99999' THEN "
            + "RAISE EXCEPTION 'forced audit failure'; END IF; RETURN NEW; END $$");
    jdbc.execute(
        "CREATE TRIGGER trg_test_fail_audit BEFORE INSERT ON public.cafeteria_settings_audit "
            + "FOR EACH ROW EXECUTE FUNCTION public.test_fail_audit()");
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

  /** Every token claims SUPER_ADMIN: only PostgreSQL may decide. */
  static RequestPostProcessor as(UUID user) {
    return jwt()
        .jwt(token -> token.subject(user.toString()).claim("role", "SUPER_ADMIN"))
        .authorities(new SimpleGrantedAuthority("ROLE_CLIENT"));
  }

  static ResultActions visibility(UUID user, UUID cafeteria, boolean visible, boolean expected)
      throws Exception {
    return mvc.perform(
        patch(ROOT + cafeteria + "/visibility")
            .with(as(user))
            .contentType(MediaType.APPLICATION_JSON)
            .content("{\"visible\":" + visible + ",\"expectedVisible\":" + expected + "}"));
  }

  static ResultActions billing(
      UUID user, UUID cafeteria, String model, Integer perOrder, Integer monthly, int version)
      throws Exception {
    return mvc.perform(
        put(ROOT + cafeteria + "/billing")
            .with(as(user))
            .contentType(MediaType.APPLICATION_JSON)
            .content(
                "{\"model\":\""
                    + model
                    + "\",\"perOrderFeeCop\":"
                    + perOrder
                    + ",\"subscriptionFeeCop\":"
                    + monthly
                    + ",\"expectedVersion\":"
                    + version
                    + "}"));
  }

  static ResultActions order(UUID client, UUID cafeteria) throws Exception {
    return mvc.perform(
        post("/api/me/orders")
            .with(as(client))
            .header("Idempotency-Key", "key-" + UUID.randomUUID())
            .contentType(MediaType.APPLICATION_JSON)
            .content(
                "{\"cafeteriaId\":\""
                    + cafeteria
                    + "\",\"note\":null,\"items\":[{\"productId\":\""
                    + PRODUCT
                    + "\",\"quantity\":1}]}"));
  }

  static int audits(UUID cafeteria) {
    return jdbc.queryForObject(
        "SELECT count(*) FROM public.cafeteria_settings_audit WHERE cafeteria_id=?",
        Integer.class,
        cafeteria);
  }

  static boolean visible(UUID cafeteria) {
    return jdbc.queryForObject(
        "SELECT is_active FROM public.cafeterias WHERE id=?", Boolean.class, cafeteria);
  }

  static Map<String, Object> billingRow(UUID cafeteria) {
    return jdbc.queryForMap(
        "SELECT billing_model, per_order_fee_cop, subscription_fee_cop, version, updated_at, updated_by FROM public.cafeteria_billing_settings WHERE cafeteria_id=?",
        cafeteria);
  }

  static String snapshot() {
    return jdbc.queryForObject(
        """
        SELECT jsonb_build_object(
          'cafeterias',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.cafeterias c),
          'billing',(SELECT jsonb_agg(to_jsonb(b) ORDER BY cafeteria_id) FROM public.cafeteria_billing_settings b),
          'audit',(SELECT count(*) FROM public.cafeteria_settings_audit))::text
        """,
        String.class);
  }

  // ---------------------------------------------------------------- visibility

  @Test
  void hidingKeepsOrdersInProgressServedAndRefusesNewOnes() throws Exception {
    UUID first = client(), second = client();
    var created = order(first, CENTRAL).andExpect(status().isCreated()).andReturn();
    String json = created.getResponse().getContentAsString();
    int start = json.indexOf("\"id\":\"") + 6;
    String orderId = json.substring(start, json.indexOf('"', start));
    // created_at comes from now() of the database; the worker queue uses the fixed test clock.
    jdbc.update(
        "UPDATE public.orders SET created_at=? WHERE id=?::uuid",
        java.sql.Timestamp.from(NOW.minusSeconds(60)),
        orderId);

    int before = audits(CENTRAL);
    visibility(SUPER, CENTRAL, false, true)
        .andExpect(status().isOk())
        .andExpect(header().string("Cache-Control", "no-store"))
        .andExpect(jsonPath("$.id").value(CENTRAL.toString()))
        .andExpect(jsonPath("$.visible").value(false))
        .andExpect(jsonPath("$.hasActiveAdmin").value(true))
        .andExpect(content().string(not(containsString("@example.invalid"))));
    try {
      assertFalse(visible(CENTRAL));
      assertEquals(before + 1, audits(CENTRAL));
      // The order already placed keeps moving through the worker's flow.
      mvc.perform(patch("/api/orders/" + orderId + "/prepare").with(as(WORKER)))
          .andExpect(status().isOk());
      assertEquals(
          "PREPARING",
          jdbc.queryForObject(
              "SELECT status::text FROM public.orders WHERE id=?::uuid", String.class, orderId));
      // A new order is refused with the kept code and the new fixed message.
      order(second, CENTRAL)
          .andExpect(status().isForbidden())
          .andExpect(jsonPath("$.code").value("CAFETERIA_NOT_SUBSCRIBED"))
          .andExpect(
              jsonPath("$.message").value("Esta cafetería no está disponible en este momento."));
      // The listing reports it hidden.
      mvc.perform(get("/api/super-admin/cafeterias").with(as(SUPER)))
          .andExpect(status().isOk())
          .andExpect(
              jsonPath("$.institutions[*].sites[*].cafeterias[?(@.id=='" + CENTRAL + "')].visible")
                  .value(contains(false)))
          .andExpect(jsonPath("$..subscribed").isEmpty());
    } finally {
      visibility(SUPER, CENTRAL, true, false).andExpect(status().isOk());
    }
    assertTrue(visible(CENTRAL));
    order(second, CENTRAL).andExpect(status().isCreated());
    var rows =
        jdbc.queryForList(
            "SELECT setting, old_value::text AS old, new_value::text AS new, changed_by, source FROM public.cafeteria_settings_audit WHERE cafeteria_id=? ORDER BY id DESC LIMIT 2",
            CENTRAL);
    assertEquals("{\"visible\": false}", rows.get(0).get("old"));
    assertEquals("{\"visible\": true}", rows.get(0).get("new"));
    assertEquals("{\"visible\": true}", rows.get(1).get("old"));
    for (var row : rows) {
      assertEquals("VISIBILITY", row.get("setting"));
      assertEquals(SUPER, row.get("changed_by"));
      assertEquals("API", row.get("source"));
    }
  }

  @Test
  void repeatingTheCurrentValueAnswers200WithoutWritingOrAuditing() throws Exception {
    String before = snapshot();
    visibility(SUPER, CENTRAL, true, true)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.visible").value(true));
    // A retry whose expected value is already stale is still the same request.
    visibility(SUPER, NORTE, false, true)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.visible").value(false));
    int version = (Integer) billingRow(NORTE).get("version");
    billing(SUPER, NORTE, "NONE", null, null, version)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.billing.version").value(version));
    assertEquals(before, snapshot());
  }

  @Test
  void aStaleExpectedValueIsA409AndChangesNothing() throws Exception {
    String before = snapshot();
    // NORTE is hidden; showing it "from visible" is stale even before the ADMIN check.
    visibility(SUPER, NORTE, true, true)
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.code").value("VISIBILITY_STATE_CHANGED"));
    int version = (Integer) billingRow(SUR).get("version");
    billing(SUPER, SUR, "PER_ORDER_FEE", 1000, null, version + 1)
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.code").value("BILLING_STATE_CHANGED"))
        .andExpect(
            jsonPath("$.message")
                .value(
                    "Otra persona cambió esta cafetería. Revisa el valor actual e inténtalo de nuevo."));
    assertEquals(before, snapshot());
  }

  @Test
  void showingACafeteriaWithoutAnActiveAdminIs409AndStaysHidden() throws Exception {
    String before = snapshot();
    visibility(SUPER, NORTE, true, false)
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.code").value("CAFETERIA_REQUIRES_ADMIN"))
        .andExpect(
            jsonPath("$.message")
                .value("Asigna un administrador activo antes de hacer visible esta cafetería."));
    assertFalse(visible(NORTE));
    assertEquals(before, snapshot());
  }

  // ---------------------------------------------------------------- billing and audit

  @Test
  void billingChangesAreVersionedAndAuditedWithBothAmounts() throws Exception {
    int version = (Integer) billingRow(SUR).get("version");
    billing(SUPER, SUR, "SUBSCRIPTION", null, 250000, version)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.billing.model").value("SUBSCRIPTION"))
        .andExpect(jsonPath("$.billing.perOrderFeeCop").isEmpty())
        .andExpect(jsonPath("$.billing.subscriptionFeeCop").value(250000))
        .andExpect(jsonPath("$.billing.version").value(version + 1))
        // Billing never changes visibility.
        .andExpect(jsonPath("$.visible").value(false));
    var row = billingRow(SUR);
    assertEquals(SUPER, row.get("updated_by"));
    assertEquals(
        NOW, ((java.sql.Timestamp) row.get("updated_at")).toInstant(), "Spring's TimeProvider");
    billing(OTHER_SUPER, SUR, "PER_ORDER_FEE", 1000, null, version + 1)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.billing.perOrderFeeCop").value(1000))
        .andExpect(jsonPath("$.billing.subscriptionFeeCop").isEmpty());
    // An emergency change by SQL, without actor, is audited too.
    jdbc.update(
        "UPDATE public.cafeteria_billing_settings SET billing_model='SUBSCRIPTION', per_order_fee_cop=NULL WHERE cafeteria_id=?",
        SUR);

    mvc.perform(get(ROOT + SUR + "/audit").param("limit", "3").with(as(SUPER)))
        .andExpect(status().isOk())
        .andExpect(header().string("Cache-Control", "no-store"))
        .andExpect(jsonPath("$.entries.length()").value(3))
        .andExpect(jsonPath("$.entries[0].setting").value("BILLING"))
        .andExpect(jsonPath("$.entries[0].source").value("SQL"))
        .andExpect(jsonPath("$.entries[0].changedBy").isEmpty())
        .andExpect(jsonPath("$.entries[0].oldValue.perOrderFeeCop").value(1000))
        .andExpect(jsonPath("$.entries[0].newValue.model").value("SUBSCRIPTION"))
        .andExpect(jsonPath("$.entries[1].source").value("API"))
        .andExpect(jsonPath("$.entries[1].changedBy.name").value("Administrador global"))
        .andExpect(jsonPath("$.entries[1].oldValue.subscriptionFeeCop").value(250000))
        .andExpect(jsonPath("$.entries[1].newValue.perOrderFeeCop").value(1000))
        .andExpect(jsonPath("$.entries[1].newValue.subscriptionFeeCop").isEmpty())
        .andExpect(jsonPath("$.entries[2].changedBy.name").value("Dueño del repositorio"))
        .andExpect(jsonPath("$.entries[2].oldValue.model").value("NONE"))
        .andExpect(jsonPath("$.entries[2].newValue.subscriptionFeeCop").value(250000))
        .andExpect(content().string(not(containsString("@example.invalid"))))
        .andExpect(content().string(not(containsString(SUPER.toString()))));
  }

  @Test
  void aFailedAuditTakesTheChangeAlong() throws Exception {
    String before = snapshot();
    int version = (Integer) billingRow(TRAP).get("version");
    billing(SUPER, TRAP, "SUBSCRIPTION", null, 99999, version)
        .andExpect(status().isInternalServerError())
        .andExpect(jsonPath("$.code").value("SUPER_ADMIN_INTERNAL_ERROR"))
        .andExpect(content().string(not(containsString("forced"))));
    assertEquals(before, snapshot());
  }

  @Test
  void theAuditIsAppendOnlyEvenForTheBackendConnection() {
    var error =
        assertThrows(
            Exception.class, () -> jdbc.update("DELETE FROM public.cafeteria_settings_audit"));
    assertTrue(error.getMessage().contains("append-only"), error.getMessage());
  }

  @Test
  void anUnknownCafeteriaIs404Everywhere() throws Exception {
    UUID missing = UUID.randomUUID();
    visibility(SUPER, missing, false, true)
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.code").value("CAFETERIA_NOT_FOUND"));
    billing(SUPER, missing, "NONE", null, null, 0)
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.code").value("CAFETERIA_NOT_FOUND"));
    mvc.perform(get(ROOT + missing + "/audit").with(as(SUPER)))
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.code").value("CAFETERIA_NOT_FOUND"));
  }

  @ParameterizedTest
  @ValueSource(strings = {"ADMIN", "WORKER", "CLIENT", "INACTIVE_SUPER"})
  void otherAccountsAre403AndNeitherWriteNorAudit(String identity) throws Exception {
    UUID user =
        switch (identity) {
          case "ADMIN" -> ADMIN;
          case "WORKER" -> WORKER;
          case "CLIENT" -> client();
          default -> {
            UUID id = UUID.randomUUID();
            inTransaction(tx -> user(tx, id, "SUPER_ADMIN", null, null));
            jdbc.update("UPDATE public.users SET is_active=false WHERE id=?", id);
            yield id;
          }
        };
    String before = snapshot();
    visibility(user, CENTRAL, false, true)
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.code").value("SUPER_ADMIN_FORBIDDEN"));
    billing(user, SUR, "PER_ORDER_FEE", 5000, null, 0)
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.code").value("SUPER_ADMIN_FORBIDDEN"));
    mvc.perform(get(ROOT + CENTRAL + "/audit").with(as(user)))
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.entries").doesNotExist());
    assertEquals(before, snapshot());
  }

  @Test
  void newCafeteriasStartWithoutBillingAndTheirOwnAuditRow() {
    UUID created = UUID.randomUUID();
    cafeteria(created, "Cafetería Nueva");
    var row = billingRow(created);
    assertEquals("NONE", row.get("billing_model"));
    assertNull(row.get("updated_by"));
    assertEquals(
        List.of(Map.of("source", "SQL")),
        jdbc.queryForList(
            "SELECT source FROM public.cafeteria_settings_audit WHERE cafeteria_id=?", created));
    assertTrue(
        OffsetDateTime.class.isInstance(
            jdbc.queryForObject(
                "SELECT changed_at FROM public.cafeteria_settings_audit WHERE cafeteria_id=?",
                OffsetDateTime.class,
                created)));
  }
}

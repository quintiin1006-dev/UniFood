package com.santotofood.config;

import static com.santotofood.config.AdminCatalogApiPostgresTest.*;
import static org.hamcrest.Matchers.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.santotofood.application.model.CatalogForm;
import com.santotofood.application.port.in.ManageAdminCatalogUseCase;
import com.santotofood.domain.model.CatalogCategory;
import java.math.BigDecimal;
import java.sql.Connection;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MvcResult;

@Timeout(60)
class AdminCatalogManagementPostgresTest {
  final List<UUID> owned = new ArrayList<>();
  static ExecutorService pool;
  static ManageAdminCatalogUseCase commands;

  @BeforeAll
  static void setup() throws Exception {
    AdminCatalogApiPostgresTest.start();
    commands = context.getBean(ManageAdminCatalogUseCase.class);
    pool = Executors.newCachedThreadPool();
  }

  @BeforeEach
  void resetFailures() {
    new AdminCatalogApiPostgresTest().reset();
  }

  @AfterEach
  void cleanup() {
    new AdminCatalogApiPostgresTest().restoreFailures();
    for (UUID id : owned) {
      jdbc.update("DELETE FROM public.daily_item_availability WHERE item_id=?", id);
      jdbc.update("DELETE FROM public.order_items WHERE lunch_id=?", id);
      jdbc.update("DELETE FROM public.lunches WHERE id=?", id);
    }
  }

  @AfterAll
  static void shutdown() throws Exception {
    pool.shutdownNow();
    AdminCatalogApiPostgresTest.stop();
  }

  CatalogForm form(String name) {
    return new CatalogForm(name, null, new BigDecimal("18500.25"), CatalogCategory.CORRIENTE);
  }

  UUID product() {
    var product = commands.create(ADMIN, form("Command " + UUID.randomUUID()));
    owned.add(product.id());
    return product.id();
  }

  String createBody(String name) {
    return "{\"name\":\""
        + name
        + "\",\"description\":null,\"price\":\"18500.25\",\"category\":\"CORRIENTE\"}";
  }

  String editBody(String name, String version) {
    return createBody(name).replace("}", ",\"expectedVersion\":\"" + version + "\"}");
  }

  String statusBody(boolean active, String version) {
    return "{\"active\":" + active + ",\"expectedVersion\":\"" + version + "\"}";
  }

  @Test
  void createEditAndStatusOnlyWriteCommercialFieldsAndReturnExactVersionedRepresentation()
      throws Exception {
    String name = "Command " + UUID.randomUUID();
    var result =
        mvc.perform(
                post(ENDPOINT)
                    .with(as(ADMIN))
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(createBody("  " + name + "  ")))
            .andExpect(status().isCreated())
            .andExpect(header().string("Cache-Control", "no-store"))
            .andExpect(jsonPath("$.version").value("0"))
            .andExpect(jsonPath("$.price").value("18500.25"))
            .andExpect(jsonPath("$.name").value(name))
            .andExpect(jsonPath("$.active").value(true))
            .andReturn();
    UUID id =
        UUID.fromString(
            tools.jackson.databind.json.JsonMapper.builder()
                .build()
                .readTree(result.getResponse().getContentAsByteArray())
                .get("id")
                .asString());
    owned.add(id);
    assertEquals(
        0, jdbc.queryForObject("SELECT stock FROM public.lunches WHERE id=?", Integer.class, id));
    assertNull(
        jdbc.queryForObject("SELECT image_url FROM public.lunches WHERE id=?", String.class, id));
    assertEquals(
        0,
        jdbc.queryForObject(
            "SELECT count(*) FROM public.daily_item_availability WHERE item_id=?",
            Integer.class,
            id));
    mvc.perform(
            patch(ENDPOINT + "/" + id)
                .with(as(ADMIN))
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    editBody(name + " edited", "0")
                        .replace("18500.25", "19750.50")
                        .replace("CORRIENTE", "ESPECIAL")
                        .replace("\"description\":null", "\"description\":\"Description edited\"")))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.price").value("19750.50"))
        .andExpect(jsonPath("$.category").value("ESPECIAL"))
        .andExpect(jsonPath("$.description").value("Description edited"))
        .andExpect(jsonPath("$.version").value("1"));
    mvc.perform(
            patch(ENDPOINT + "/" + id + "/status")
                .with(as(ADMIN))
                .contentType(MediaType.APPLICATION_JSON)
                .content(statusBody(false, "1")))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.active").value(false))
        .andExpect(jsonPath("$.version").value("2"));
    mvc.perform(
            patch(ENDPOINT + "/" + id)
                .with(as(ADMIN))
                .contentType(MediaType.APPLICATION_JSON)
                .content(editBody("stale", "0")))
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.code").value("ADMIN_CATALOG_STALE_VERSION"));
    assertEquals(
        name + " edited",
        jdbc.queryForObject("SELECT name FROM public.lunches WHERE id=?", String.class, id));
  }

  @ParameterizedTest
  @ValueSource(strings = {"CLIENT", "WORKER", "SUPER", "INACTIVE", "UNASSIGNED", "UNKNOWN"})
  void allBusinessDenialsAreEnforcedOnEveryCommand(String role) throws Exception {
    UUID user =
        switch (role) {
          case "CLIENT" -> CLIENT;
          case "WORKER" -> WORKER;
          case "SUPER" -> SUPER;
          case "INACTIVE" -> INACTIVE;
          case "UNASSIGNED" -> UNASSIGNED;
          default -> UUID.randomUUID();
        };
    String id = UUID.randomUUID().toString();
    for (var request :
        List.of(
            post(ENDPOINT).content(createBody("Command denied")),
            patch(ENDPOINT + "/" + id).content(editBody("denied", "0")),
            patch(ENDPOINT + "/" + id + "/status").content(statusBody(false, "0"))))
      mvc.perform(request.with(as(user)).contentType(MediaType.APPLICATION_JSON))
          .andExpect(status().isForbidden())
          .andExpect(jsonPath("$.code").value("ADMIN_CATALOG_FORBIDDEN"));
  }

  @Test
  void missingInvalidAndMalformedIdentitiesCannotWrite() throws Exception {
    mvc.perform(
            post(ENDPOINT).contentType(MediaType.APPLICATION_JSON).content(createBody("denied")))
        .andExpect(status().isUnauthorized());
    mvc.perform(
            post(ENDPOINT)
                .header("Authorization", "Bearer invalid")
                .contentType(MediaType.APPLICATION_JSON)
                .content(createBody("denied")))
        .andExpect(status().isUnauthorized());
    mvc.perform(
            post(ENDPOINT)
                .with(
                    org.springframework.security.test.web.servlet.request
                        .SecurityMockMvcRequestPostProcessors.jwt()
                        .jwt(j -> j.subject("bad")))
                .contentType(MediaType.APPLICATION_JSON)
                .content(createBody("denied")))
        .andExpect(status().isForbidden());
  }

  @Test
  void inactiveCafeteriaRemainsReadableButCannotWrite() throws Exception {
    jdbc.update("UPDATE public.cafeterias SET is_active=false WHERE id=?", CAFE);
    try {
      mvc.perform(get(ENDPOINT).with(as(ADMIN))).andExpect(status().isOk());
      mvc.perform(
              post(ENDPOINT)
                  .with(as(ADMIN))
                  .contentType(MediaType.APPLICATION_JSON)
                  .content(createBody("denied")))
          .andExpect(status().isForbidden())
          .andExpect(jsonPath("$.code").value("ADMIN_CATALOG_CAFETERIA_INACTIVE"));
    } finally {
      jdbc.update("UPDATE public.cafeterias SET is_active=true WHERE id=?", CAFE);
    }
  }

  @Test
  void foreignAndNonexistentHaveIdenticalSafe404() throws Exception {
    UUID foreign =
        jdbc.queryForObject(
            "SELECT id FROM public.lunches WHERE cafeteria_id=? LIMIT 1", UUID.class, OTHER_CAFE);
    for (UUID id : List.of(foreign, UUID.randomUUID()))
      for (var request :
          List.of(
              patch(ENDPOINT + "/" + id).content(editBody("unknown", "0")),
              patch(ENDPOINT + "/" + id + "/status").content(statusBody(false, "0"))))
        mvc.perform(request.with(as(ADMIN)).contentType(MediaType.APPLICATION_JSON))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.code").value("ADMIN_CATALOG_PRODUCT_NOT_FOUND"))
            .andExpect(
                jsonPath("$.message").value("El producto no está disponible en tu catálogo."));
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "{}",
        "[]",
        "null",
        "{",
        "{\"name\":1}",
        "{\"name\":\"a\",\"price\":1,\"category\":\"CORRIENTE\"}",
        "{\"name\":\"a\",\"price\":\"0\",\"category\":\"CORRIENTE\"}",
        "{\"name\":\"a\",\"price\":\"-1.00\",\"category\":\"CORRIENTE\"}",
        "{\"name\":\"a\",\"price\":\"1.001\",\"category\":\"CORRIENTE\"}",
        "{\"name\":\"a\",\"price\":\"1e2\",\"category\":\"CORRIENTE\"}",
        "{\"name\":\"a\",\"price\":\"NaN\",\"category\":\"CORRIENTE\"}",
        "{\"name\":\"a\",\"price\":\"10000000000.00\",\"category\":\"CORRIENTE\"}",
        "{\"name\":\"a\",\"price\":\"1\",\"category\":\"BEBIDAS\"}",
        "{\"name\":\"a\",\"name\":\"b\",\"price\":\"1\",\"category\":\"CORRIENTE\"}",
        "{\"name\":\"a\",\"price\":\"1\",\"category\":\"CORRIENTE\",\"cafeteriaId\":\"foreign\"}",
        "{\"name\":\"a\",\"price\":\"1\",\"category\":\"CORRIENTE\"} {}"
      })
  void invalidJsonAndCommercialContractsAre400Not500(String body) throws Exception {
    mvc.perform(
            post(ENDPOINT).with(as(ADMIN)).contentType(MediaType.APPLICATION_JSON).content(body))
        .andExpect(status().isBadRequest())
        .andExpect(header().string("Cache-Control", "no-store"))
        .andExpect(jsonPath("$.code").value("ADMIN_CATALOG_INVALID_REQUEST"));
  }

  @Test
  void unicodeLimitsDescriptionsBodyLimitsAndInvalidVersionsAreStrict() throws Exception {
    UUID id = product();
    mvc.perform(
            patch(ENDPOINT + "/" + id)
                .with(as(ADMIN))
                .contentType(MediaType.APPLICATION_JSON)
                .content(editBody("partial form", "0").replace("\"description\":null,", "")))
        .andExpect(status().isBadRequest());
    for (String version : List.of("-1", "01", "1.0", "9223372036854775808", ""))
      mvc.perform(
              patch(ENDPOINT + "/" + id)
                  .with(as(ADMIN))
                  .contentType(MediaType.APPLICATION_JSON)
                  .content(editBody("name", version)))
          .andExpect(status().isBadRequest());
    for (String body :
        List.of(
            createBody("a".repeat(151)),
            createBody("x").replace("null", "\"" + "x".repeat(2001) + "\""),
            " ".repeat(17000),
            statusBody(true, "0").replace("\"0\"", "0"),
            statusBody(true, "0").replace("true", "\"true\"")))
      mvc.perform(
              (body.contains("\"active\"")
                      ? patch(ENDPOINT + "/" + id + "/status")
                      : post(ENDPOINT))
                  .with(as(ADMIN))
                  .contentType(MediaType.APPLICATION_JSON)
                  .content(body))
          .andExpect(status().isBadRequest());
    mvc.perform(
            patch(ENDPOINT + "/not-a-uuid")
                .with(as(ADMIN))
                .contentType(MediaType.APPLICATION_JSON)
                .content(editBody("x", "0")))
        .andExpect(status().isBadRequest());
    var unicode = commands.create(ADMIN, form("🍚".repeat(150)));
    owned.add(unicode.id());
    assertEquals(150, unicode.name().codePointCount(0, unicode.name().length()));
  }

  @Test
  void duplicateNamesAreSafeAndCaseSensitiveAsTheExistingConstraint() throws Exception {
    UUID id = product();
    String name =
        jdbc.queryForObject("SELECT name FROM public.lunches WHERE id=?", String.class, id);
    mvc.perform(
            post(ENDPOINT)
                .with(as(ADMIN))
                .contentType(MediaType.APPLICATION_JSON)
                .content(createBody(name)))
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.code").value("ADMIN_CATALOG_DUPLICATE_NAME"))
        .andExpect(content().string(not(containsString("uq_lunch"))));
    var lower = commands.create(ADMIN, form(name.toLowerCase(Locale.ROOT)));
    owned.add(lower.id());
    assertNotEquals(id, lower.id());
  }

  @Test
  void concurrentSameVersionHasExactlyOneWinnerIncludingStatusAgainstEdit() throws Exception {
    UUID id = product();
    var start = new CountDownLatch(1);
    var a =
        pool.submit(
            () -> {
              start.await();
              return mvc.perform(
                      patch(ENDPOINT + "/" + id)
                          .with(as(ADMIN))
                          .contentType(MediaType.APPLICATION_JSON)
                          .content(editBody("Command winner", "0")))
                  .andReturn()
                  .getResponse()
                  .getStatus();
            });
    var b =
        pool.submit(
            () -> {
              start.await();
              return mvc.perform(
                      patch(ENDPOINT + "/" + id + "/status")
                          .with(as(ADMIN))
                          .contentType(MediaType.APPLICATION_JSON)
                          .content(statusBody(false, "0")))
                  .andReturn()
                  .getResponse()
                  .getStatus();
            });
    start.countDown();
    assertEquals(
        Set.of(200, 409), Set.of(a.get(15, TimeUnit.SECONDS), b.get(15, TimeUnit.SECONDS)));
    assertEquals(
        1L, jdbc.queryForObject("SELECT version FROM public.lunches WHERE id=?", Long.class, id));
  }

  @Test
  void concurrentCreatesOnlyOneNameAndNoDuplicateRetry() throws Exception {
    String name = "Command " + UUID.randomUUID();
    Callable<MvcResult> task =
        () ->
            mvc.perform(
                    post(ENDPOINT)
                        .with(as(ADMIN))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(createBody(name)))
                .andReturn();
    var a = pool.submit(task);
    var b = pool.submit(task);
    assertEquals(
        Set.of(201, 409),
        Set.of(
            a.get(15, TimeUnit.SECONDS).getResponse().getStatus(),
            b.get(15, TimeUnit.SECONDS).getResponse().getStatus()));
    owned.add(
        jdbc.queryForObject(
            "SELECT id FROM public.lunches WHERE cafeteria_id=? AND name=?",
            UUID.class,
            CAFE,
            name));
  }

  void daily(UUID id, String date, boolean enabled) {
    jdbc.update(
        "INSERT INTO public.daily_item_availability(cafeteria_id,item_id,business_date,is_available) VALUES (?,?,?::date,?) ON CONFLICT(item_id,business_date) DO UPDATE SET is_available=EXCLUDED.is_available",
        CAFE,
        id,
        date,
        enabled);
  }

  String today() {
    return com.santotofood.domain.model.BusinessDate.from(java.time.Instant.now())
        .value()
        .toString();
  }

  @Test
  void reactivationDisablesOnlyTodayAndPreservesHistoryAndWorkerOwnership() {
    UUID id = product();
    daily(id, today(), true);
    daily(id, "2000-01-01", true);
    commands.status(ADMIN, id, 0, false);
    commands.status(ADMIN, id, 1, true);
    assertFalse(
        jdbc.queryForObject(
            "SELECT is_available FROM public.daily_item_availability WHERE item_id=? AND business_date=?::date",
            Boolean.class,
            id,
            today()));
    assertTrue(
        jdbc.queryForObject(
            "SELECT is_available FROM public.daily_item_availability WHERE item_id=? AND business_date='2000-01-01'",
            Boolean.class,
            id));
    daily(id, today(), true);
    commands.status(ADMIN, id, 2, true); // already active is not a reactivation
    assertTrue(
        jdbc.queryForObject(
            "SELECT is_available FROM public.daily_item_availability WHERE item_id=? AND business_date=?::date",
            Boolean.class,
            id,
            today()));
  }

  @Test
  void workerShareLockSerializesDeactivationWithoutDeadlock() throws Exception {
    UUID id = product();
    try (Connection worker = source.getConnection()) {
      worker.setAutoCommit(false);
      try (var q =
          worker.prepareStatement("SELECT is_active FROM public.cafeterias WHERE id=? FOR SHARE")) {
        q.setObject(1, CAFE);
        q.executeQuery().close();
      }
      try (var q =
          worker.prepareStatement("SELECT is_active FROM public.lunches WHERE id=? FOR SHARE")) {
        q.setObject(1, id);
        q.executeQuery().close();
      }
      var result = pool.submit(() -> commands.status(ADMIN, id, 0, false));
      waitForLock();
      try (var q =
          worker.prepareStatement(
              "INSERT INTO public.daily_item_availability(cafeteria_id,item_id,business_date,is_available) VALUES (?,?,?::date,true)")) {
        q.setObject(1, CAFE);
        q.setObject(2, id);
        q.setString(3, today());
        q.executeUpdate();
      }
      worker.commit();
      assertFalse(result.get(15, TimeUnit.SECONDS).active());
    }
    commands.status(ADMIN, id, 1, true);
    assertFalse(
        jdbc.queryForObject(
            "SELECT is_available FROM public.daily_item_availability WHERE item_id=?",
            Boolean.class,
            id));
  }

  @Test
  void cafeteriaDeactivationWinsBeforeAdmissionAndWriterCannotCommitBehindIt() throws Exception {
    try (Connection owner = source.getConnection()) {
      owner.setAutoCommit(false);
      try (var q =
          owner.prepareStatement("UPDATE public.cafeterias SET is_active=false WHERE id=?")) {
        q.setObject(1, CAFE);
        q.executeUpdate();
      }
      var denied =
          pool.submit(
              () ->
                  mvc.perform(
                          post(ENDPOINT)
                              .with(as(ADMIN))
                              .contentType(MediaType.APPLICATION_JSON)
                              .content(createBody("Command denied")))
                      .andReturn()
                      .getResponse()
                      .getStatus());
      waitForLock();
      owner.commit();
      assertEquals(403, denied.get(15, TimeUnit.SECONDS));
    } finally {
      jdbc.update("UPDATE public.cafeterias SET is_active=true WHERE id=?", CAFE);
    }
  }

  @Test
  void revocationWinsGuardAndFreshAuthorizationRejectsTheWaitingWriter() throws Exception {
    try (Connection owner = source.getConnection()) {
      owner.setAutoCommit(false);
      try (var q =
          owner.prepareStatement("UPDATE public.cafeterias SET is_active=false WHERE id=?")) {
        q.setObject(1, CAFE);
        q.executeUpdate();
      }
      try (var q = owner.prepareStatement("UPDATE public.users SET is_active=false WHERE id=?")) {
        q.setObject(1, ADMIN);
        q.executeUpdate();
      }
      try (var q = owner.prepareStatement("DELETE FROM public.cafeteria_users WHERE user_id=?")) {
        q.setObject(1, ADMIN);
        q.executeUpdate();
      }
      try (var q = owner.prepareStatement("DELETE FROM public.user_roles WHERE user_id=?")) {
        q.setObject(1, ADMIN);
        q.executeUpdate();
      }
      var denied =
          pool.submit(
              () ->
                  mvc.perform(
                          post(ENDPOINT)
                              .with(as(ADMIN))
                              .contentType(MediaType.APPLICATION_JSON)
                              .content(createBody("Command denied")))
                      .andReturn()
                      .getResponse()
                      .getStatus());
      waitForLock();
      owner.commit();
      assertEquals(403, denied.get(15, TimeUnit.SECONDS));
    } finally {
      try (Connection restore = source.getConnection()) {
        restore.setAutoCommit(false);
        try (var q =
            restore.prepareStatement(
                "INSERT INTO public.user_roles(user_id,role_id) SELECT ?,id FROM public.roles WHERE name='ADMIN'")) {
          q.setObject(1, ADMIN);
          q.executeUpdate();
        }
        try (var q =
            restore.prepareStatement(
                "INSERT INTO public.cafeteria_users(user_id,cafeteria_id) VALUES (?,?)")) {
          q.setObject(1, ADMIN);
          q.setObject(2, CAFE);
          q.executeUpdate();
        }
        try (var q =
            restore.prepareStatement("UPDATE public.users SET is_active=true WHERE id=?")) {
          q.setObject(1, ADMIN);
          q.executeUpdate();
        }
        try (var q =
            restore.prepareStatement("UPDATE public.cafeterias SET is_active=true WHERE id=?")) {
          q.setObject(1, CAFE);
          q.executeUpdate();
        }
        restore.commit();
      }
    }
  }

  @Test
  void fifoCafeteriaExclusiveLockPrecedesCatalogProductLock() throws Exception {
    UUID id = product();
    try (Connection fifo = source.getConnection()) {
      fifo.setAutoCommit(false);
      try (var q =
          fifo.prepareStatement("SELECT id FROM public.cafeterias WHERE id=? FOR UPDATE")) {
        q.setObject(1, CAFE);
        q.executeQuery().close();
      }
      var edited = pool.submit(() -> commands.edit(ADMIN, id, 0, form("Command after FIFO")));
      waitForLock();
      fifo.commit();
      assertEquals(1, edited.get(15, TimeUnit.SECONDS).version());
    }
  }

  @Test
  void sqlWritesInvalidateCasAndRevisionsRemainLosslessAboveJavascriptSafeInteger()
      throws Exception {
    UUID id = product();
    jdbc.update("UPDATE public.lunches SET version=999,stock=7 WHERE id=?", id);
    assertEquals(
        1L, jdbc.queryForObject("SELECT version FROM public.lunches WHERE id=?", Long.class, id));
    mvc.perform(
            patch(ENDPOINT + "/" + id)
                .with(as(ADMIN))
                .contentType(MediaType.APPLICATION_JSON)
                .content(editBody("bad", "0")))
        .andExpect(status().isConflict());
    jdbc.execute("ALTER TABLE public.lunches DISABLE TRIGGER trg_lunch_version");
    try {
      jdbc.update("UPDATE public.lunches SET version=9007199254740992 WHERE id=?", id);
    } finally {
      jdbc.execute("ALTER TABLE public.lunches ENABLE TRIGGER trg_lunch_version");
    }
    mvc.perform(
            patch(ENDPOINT + "/" + id)
                .with(as(ADMIN))
                .contentType(MediaType.APPLICATION_JSON)
                .content(editBody("Command precise", "9007199254740992")))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.version").value("9007199254740993"));
    assertEquals(
        7, jdbc.queryForObject("SELECT stock FROM public.lunches WHERE id=?", Integer.class, id));
  }

  @Test
  void snapshotsAndLongLegacyDescriptionsSurviveCommercialAndStatusChanges() {
    UUID id = product(), order = UUID.randomUUID();
    jdbc.update(
        "INSERT INTO public.orders(id,cafeteria_id,client_name,total) VALUES (?,?,'Historical client',18500.25)",
        order,
        CAFE);
    jdbc.update(
        "INSERT INTO public.order_items(order_id,lunch_id,cafeteria_id,lunch_name,unit_price,quantity,subtotal) VALUES (?,?,?,'Historical product',18500.25,1,18500.25)",
        order,
        id,
        CAFE);
    String snapshot =
        jdbc.queryForObject(
            "SELECT row_to_json(i)::text FROM public.order_items i WHERE lunch_id=?",
            String.class,
            id);
    jdbc.update("UPDATE public.lunches SET description=? WHERE id=?", "legacy".repeat(500), id);
    commands.status(ADMIN, id, 1, false);
    assertEquals(
        3000,
        jdbc.queryForObject(
            "SELECT length(description) FROM public.lunches WHERE id=?", Integer.class, id));
    commands.edit(
        ADMIN,
        id,
        2,
        new CatalogForm(
            "Command changed", null, new BigDecimal("999.99"), CatalogCategory.ESPECIAL));
    assertEquals(
        new BigDecimal("999.99"),
        jdbc.queryForObject("SELECT price FROM public.lunches WHERE id=?", BigDecimal.class, id));
    assertEquals(
        "ESPECIAL",
        jdbc.queryForObject(
            "SELECT category::text FROM public.lunches WHERE id=?", String.class, id));
    assertEquals(
        snapshot,
        jdbc.queryForObject(
            "SELECT row_to_json(i)::text FROM public.order_items i WHERE lunch_id=?",
            String.class,
            id));
    jdbc.update("DELETE FROM public.order_items WHERE lunch_id=?", id);
    jdbc.update("DELETE FROM public.orders WHERE id=?", order);
  }

  @Test
  void temporaryAndUnexpectedCommandFailuresAreSanitizedAndRollback() throws Exception {
    UUID id = product();
    source.unavailable = true;
    try {
      mvc.perform(
              patch(ENDPOINT + "/" + id)
                  .with(as(ADMIN))
                  .contentType(MediaType.APPLICATION_JSON)
                  .content(editBody("bad", "0")))
          .andExpect(status().isServiceUnavailable())
          .andExpect(header().string("Retry-After", "5"))
          .andExpect(content().string(not(containsString("PRIVATE"))));
    } finally {
      source.unavailable = false;
    }
    assertEquals(
        0L, jdbc.queryForObject("SELECT version FROM public.lunches WHERE id=?", Long.class, id));
  }

  @Test
  void reactivationSerializesWithTheRealWorkerServiceAndOnlyItsLaterEnableWins() throws Exception {
    UUID id = product();
    daily(id, today(), true);
    commands.status(ADMIN, id, 0, false);
    var worker =
        context.getBean(com.santotofood.application.port.in.SetDailyAvailabilityUseCase.class);
    try (Connection row = source.getConnection()) {
      row.setAutoCommit(false);
      try (var q =
          row.prepareStatement(
              "SELECT item_id FROM public.daily_item_availability WHERE item_id=? FOR UPDATE")) {
        q.setObject(1, id);
        q.executeQuery().close();
      }
      var activated = pool.submit(() -> commands.status(ADMIN, id, 1, true));
      waitForLocks(1);
      var enabled =
          pool.submit(() -> worker.setItem(CAFE, id, java.time.LocalDate.parse(today()), true));
      waitForLocks(2);
      row.commit();
      assertTrue(activated.get(15, TimeUnit.SECONDS).active());
      assertTrue(enabled.get(15, TimeUnit.SECONDS).available());
      assertTrue(
          jdbc.queryForObject(
              "SELECT is_available FROM public.daily_item_availability WHERE item_id=?",
              Boolean.class,
              id));
    }
  }

  @Test
  void oppositeStatusRequestsCannotOverwriteTheWinner() throws Exception {
    UUID id = product();
    commands.status(ADMIN, id, 0, false);
    var start = new CountDownLatch(1);
    var a =
        pool.submit(
            () -> {
              start.await();
              return mvc.perform(
                      patch(ENDPOINT + "/" + id + "/status")
                          .with(as(ADMIN))
                          .contentType(MediaType.APPLICATION_JSON)
                          .content(statusBody(true, "1")))
                  .andReturn()
                  .getResponse()
                  .getStatus();
            });
    var b =
        pool.submit(
            () -> {
              start.await();
              return mvc.perform(
                      patch(ENDPOINT + "/" + id + "/status")
                          .with(as(ADMIN))
                          .contentType(MediaType.APPLICATION_JSON)
                          .content(statusBody(false, "1")))
                  .andReturn()
                  .getResponse()
                  .getStatus();
            });
    start.countDown();
    assertEquals(
        Set.of(200, 409), Set.of(a.get(15, TimeUnit.SECONDS), b.get(15, TimeUnit.SECONDS)));
    assertEquals(
        2L, jdbc.queryForObject("SELECT version FROM public.lunches WHERE id=?", Long.class, id));
  }

  @Test
  void failedAvailabilityResetRollsBackProductStatusAndRevision() throws Exception {
    UUID id = product();
    daily(id, today(), true);
    commands.status(ADMIN, id, 0, false);
    jdbc.execute(
        "CREATE FUNCTION public.test_catalog_reset_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'PRIVATE_RESET_FAILURE'; END $$");
    jdbc.execute(
        "CREATE TRIGGER test_catalog_reset_failure BEFORE UPDATE ON public.daily_item_availability FOR EACH ROW EXECUTE FUNCTION public.test_catalog_reset_failure()");
    try {
      mvc.perform(
              patch(ENDPOINT + "/" + id + "/status")
                  .with(as(ADMIN))
                  .contentType(MediaType.APPLICATION_JSON)
                  .content(statusBody(true, "1")))
          .andExpect(status().isInternalServerError())
          .andExpect(content().string(not(containsString("PRIVATE"))));
      assertFalse(
          jdbc.queryForObject(
              "SELECT is_active FROM public.lunches WHERE id=?", Boolean.class, id));
      assertEquals(
          1L, jdbc.queryForObject("SELECT version FROM public.lunches WHERE id=?", Long.class, id));
      assertTrue(
          jdbc.queryForObject(
              "SELECT is_available FROM public.daily_item_availability WHERE item_id=?",
              Boolean.class,
              id));
    } finally {
      jdbc.execute("DROP TRIGGER test_catalog_reset_failure ON public.daily_item_availability");
      jdbc.execute("DROP FUNCTION public.test_catalog_reset_failure()");
    }
  }

  static void waitForLock() throws Exception {
    waitForLocks(1);
  }

  static void waitForLocks(int count) throws Exception {
    long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
    while (System.nanoTime() < deadline) {
      if (jdbc.queryForObject(
              "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'",
              Integer.class)
          >= count) return;
      Thread.sleep(15);
    }
    fail("Expected a real PostgreSQL lock wait");
  }
}

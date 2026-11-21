package com.santotofood.adapter.out.persistence;

import static org.junit.jupiter.api.Assertions.*;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.SQLException;
import java.time.LocalDate;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.*;
import org.postgresql.util.PSQLException;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;

/**
 * Migration 031 (daily menu) and scripts/supabase/seed-daily-menu.sql on an isolated local cluster
 * with every migration applied. Never uses an external database URL.
 */
@Timeout(120)
class DailyMenuPostgresTest {
  static final List<String> TABLES =
      List.of(
          "daily_menu_settings",
          "daily_menu_categories",
          "daily_menu_additions",
          "daily_menu_days",
          "daily_menu_options",
          "daily_menu_addition_availability",
          "order_daily_menus",
          "order_daily_menu_choices");
  static final Path MIGRATION = Path.of("supabase/migrations/031_daily_menu.sql");
  static final Path SEED = Path.of("../scripts/supabase/seed-daily-menu.sql");
  static final UUID CENTRAL = UUID.randomUUID();
  static final UUID MENU_CAFE = UUID.randomUUID();
  static final UUID OTHER_CAFE = UUID.randomUUID();
  static final UUID WORKER = UUID.randomUUID();
  static final UUID LUNCH = UUID.randomUUID();
  static final UUID OTHER_LUNCH = UUID.randomUUID();
  static final AtomicInteger CODES = new AtomicInteger(500000);
  static final AtomicInteger DAYS = new AtomicInteger();
  static Process database;
  static JdbcTemplate jdbc;
  static UUID single;
  static UUID additions;
  static UUID otherSingle;
  static UUID addition;

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
    jdbc = new JdbcTemplate(new DriverManagerDataSource(url, "postgres", ""));
    seed();
  }

  @AfterAll
  static void stop() throws Exception {
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
    for (var cafe :
        List.of(
            List.of(CENTRAL, "Cafetería Central"),
            List.of(MENU_CAFE, "Cafetería Menú"),
            List.of(OTHER_CAFE, "Cafetería Norte")))
      jdbc.update(
          "INSERT INTO public.cafeterias(id,site_id,name,is_active,lunch_order_start,lunch_order_end) VALUES (?,?,?,false,'06:00','18:00')",
          cafe.get(0),
          site,
          cafe.get(1));
    jdbc.update(
        "INSERT INTO public.lunches(id,cafeteria_id,name,price,category) VALUES (?,?,'Corriente',13000,'CORRIENTE'),(?,?,'Corriente',13000,'CORRIENTE')",
        LUNCH,
        MENU_CAFE,
        OTHER_LUNCH,
        OTHER_CAFE);
    staff(WORKER, CENTRAL);
    single = category(MENU_CAFE, "Proteína", "SINGLE", 0, false);
    additions = category(MENU_CAFE, "Adiciones", "ADDITIONS", 1, true);
    otherSingle = category(OTHER_CAFE, "Proteína", "SINGLE", 0, false);
    addition =
        jdbc.queryForObject(
            "INSERT INTO public.daily_menu_additions(cafeteria_id,name,extra_price) VALUES (?,'Huevo frito',2000) RETURNING id",
            UUID.class,
            MENU_CAFE);
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

  static UUID category(UUID cafe, String label, String kind, int position, boolean canSkip) {
    return jdbc.queryForObject(
        "INSERT INTO public.daily_menu_categories(cafeteria_id,label,kind,position,can_skip) VALUES (?,?,?,?,?) RETURNING id",
        UUID.class,
        cafe,
        label,
        kind,
        position,
        canSkip);
  }

  /** A fresh day header for {@code cafe}; each call uses its own past date. */
  static LocalDate day(UUID cafe) {
    LocalDate date = LocalDate.of(2026, 1, 1).plusDays(DAYS.incrementAndGet());
    jdbc.update(
        "INSERT INTO public.daily_menu_days(cafeteria_id,business_date) VALUES (?,?)", cafe, date);
    return date;
  }

  static void option(UUID cafe, LocalDate date, UUID category, String label) {
    jdbc.update(
        "INSERT INTO public.daily_menu_options(cafeteria_id,business_date,category_id,label) VALUES (?,?,?,?)",
        cafe,
        date,
        category,
        label);
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

  static UUID order(UUID user, UUID cafe) {
    UUID id = UUID.randomUUID();
    jdbc.update(
        "INSERT INTO public.orders(id,cafeteria_id,client_id,client_name,status,total,client_code,client_type) "
            + "SELECT ?,?,c.id,c.full_name,'PENDING',9500,c.institutional_code,c.client_type FROM public.clients c WHERE c.user_id=?",
        id,
        cafe,
        user);
    return id;
  }

  /** An order of a new client in MENU_CAFE with its daily menu header. */
  static UUID menuOrder() {
    UUID order = order(client(), MENU_CAFE);
    jdbc.update(
        "INSERT INTO public.order_daily_menus(order_id,cafeteria_id,business_date,title_snapshot,plate_price) VALUES (?,?,DATE '2026-01-01','Almuerzo del día',9500)",
        order,
        MENU_CAFE);
    return order;
  }

  static void choice(
      UUID order, String kind, UUID category, String label, Integer price, UUID opt, UUID add) {
    jdbc.update(
        "INSERT INTO public.order_daily_menu_choices(order_id,cafeteria_id,line_kind,category_id,category_label,option_label,extra_price,source_option_id,source_addition_id) VALUES (?,?,?,?,'Categoría',?,?,?,?)",
        order,
        MENU_CAFE,
        kind,
        category,
        label,
        price,
        opt,
        add);
  }

  static PSQLException failure(String state, Runnable action) {
    var error = assertThrows(DataAccessException.class, action::run);
    var cause = assertInstanceOf(PSQLException.class, error.getMostSpecificCause());
    assertEquals(state, cause.getSQLState(), cause.getMessage());
    return cause;
  }

  static void failure(String state, String constraint, Runnable action) {
    var cause = failure(state, action);
    assertNotNull(cause.getServerErrorMessage());
    assertEquals(constraint, cause.getServerErrorMessage().getConstraint(), cause.getMessage());
  }

  static void runScript(Path script, boolean stagingTarget) throws Exception {
    try (var connection = jdbc.getDataSource().getConnection();
        var statement = connection.createStatement()) {
      if (stagingTarget) statement.execute("SET unifood.seed_target = 'staging'");
      statement.execute(Files.readString(script, StandardCharsets.UTF_8));
    }
  }

  static int count(String sql, Object... args) {
    return jdbc.queryForObject(sql, Integer.class, args);
  }

  // ---------------------------------------------------------------- RLS and privileges

  @Test
  void everyTableHasRlsWithoutPoliciesAndNoBrowserPrivilege() {
    for (String table : TABLES) {
      String name = "public." + table;
      assertTrue(
          jdbc.queryForObject(
              "SELECT relrowsecurity FROM pg_class WHERE oid = ?::regclass", Boolean.class, name),
          table);
      assertEquals(
          0,
          count(
              "SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename=?", table),
          table);
      for (String role : List.of("anon", "authenticated", "public"))
        assertFalse(
            jdbc.queryForObject(
                "SELECT has_table_privilege(?, ?, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')",
                Boolean.class,
                role,
                name),
            role + " on " + table);
      for (String role : List.of("anon", "authenticated"))
        assertFalse(
            jdbc.queryForObject(
                "SELECT has_any_column_privilege(?, ?, 'SELECT,INSERT,UPDATE,REFERENCES')",
                Boolean.class,
                role,
                name),
            role + " columns of " + table);
    }
    for (String function :
        List.of("public.guard_daily_menu_option()", "public.forbid_daily_menu_snapshot_change()"))
      for (String role : List.of("anon", "authenticated", "public"))
        assertFalse(
            jdbc.queryForObject(
                "SELECT has_function_privilege(?, ?, 'EXECUTE')", Boolean.class, role, function),
            role + " on " + function);
  }

  @Test
  void migrationRunsAgainWithoutChangingData() throws Exception {
    int before = count("SELECT count(*) FROM public.daily_menu_categories");
    runScript(MIGRATION, false);
    assertEquals(before, count("SELECT count(*) FROM public.daily_menu_categories"));
    assertEquals(
        1,
        count(
            "SELECT count(*) FROM pg_trigger WHERE tgname='trg_daily_menu_option_guard' AND NOT tgisinternal"));
  }

  // ---------------------------------------------------------------- option guard

  @Test
  void optionGuardRejectsAdditionsCategory() {
    LocalDate date = day(MENU_CAFE);
    failure(
        "23514",
        "daily_menu_option_category_kind",
        () -> option(MENU_CAFE, date, additions, "Huevo"));
  }

  @Test
  void optionGuardAcceptsExactly350AndRejectsMore() {
    LocalDate date = day(MENU_CAFE);
    option(MENU_CAFE, date, single, "a".repeat(200));
    option(MENU_CAFE, date, single, "b".repeat(150));
    assertEquals(
        350,
        count(
            "SELECT sum(length(label)) FROM public.daily_menu_options WHERE cafeteria_id=? AND business_date=? AND category_id=?",
            MENU_CAFE,
            date,
            single));
    failure("23514", "daily_menu_option_text_budget", () -> option(MENU_CAFE, date, single, "c"));

    LocalDate other = day(MENU_CAFE);
    option(MENU_CAFE, other, single, "x".repeat(350));
    failure(
        "23514",
        "daily_menu_option_text_budget",
        () ->
            jdbc.update(
                "INSERT INTO public.daily_menu_options(cafeteria_id,business_date,category_id,label) VALUES (?,?,?,'y')",
                MENU_CAFE,
                other,
                single));
    // Updating a row counts it once: the same 350 characters still fit.
    jdbc.update(
        "UPDATE public.daily_menu_options SET label=? WHERE cafeteria_id=? AND business_date=?",
        "z".repeat(350),
        MENU_CAFE,
        other);
  }

  @Test
  void optionLabelRulesAndDuplicates() {
    LocalDate date = day(MENU_CAFE);
    option(MENU_CAFE, date, single, "Pollo");
    failure("23505", "uq_daily_menu_options_label", () -> option(MENU_CAFE, date, single, "POLLO"));
    failure(
        "23514",
        "chk_daily_menu_options_label",
        () -> option(MENU_CAFE, date, single, "Arroz, papa"));
    failure("23514", "chk_daily_menu_options_label", () -> option(MENU_CAFE, date, single, " Res"));
  }

  // ---------------------------------------------------------------- unique indexes

  @Test
  void oneAdditionsCategoryPerCafeteria() {
    failure(
        "23505",
        "uq_daily_menu_categories_one_additions",
        () -> category(MENU_CAFE, "Extras", "ADDITIONS", 9, true));
    failure(
        "23514",
        "chk_daily_menu_categories_additions_optional",
        () -> category(OTHER_CAFE, "Extras", "ADDITIONS", 9, false));
    failure(
        "23505",
        "uq_daily_menu_categories_label",
        () -> category(MENU_CAFE, "proteína", "SINGLE", 8, false));
  }

  @Test
  void oneChoicePerCategoryAndAdditionOncePerOrder() {
    UUID order = menuOrder();
    choice(order, "OPTION", single, "Pollo", null, UUID.randomUUID(), null);
    failure(
        "23505",
        "uq_choice_one_per_category",
        () -> choice(order, "NONE", single, null, null, null, null));
    choice(order, "ADDITION", additions, "Huevo frito", 2000, null, addition);
    failure(
        "23505",
        "uq_choice_addition_once",
        () -> choice(order, "ADDITION", additions, "Huevo frito", 2000, null, addition));
  }

  // ---------------------------------------------------------------- choice shape

  @Test
  void choiceShapeCheck() {
    UUID order = menuOrder();
    failure(
        "23514",
        "chk_choice_shape",
        () -> choice(order, "OPTION", single, "Pollo", null, null, null));
    failure(
        "23514",
        "chk_choice_shape",
        () -> choice(order, "ADDITION", additions, "Huevo frito", 0, null, addition));
    failure(
        "23514",
        "chk_choice_shape",
        () -> choice(order, "NONE", single, "Ninguna", null, null, null));
    failure(
        "23514", "chk_choice_shape", () -> choice(order, "OTHER", single, null, null, null, null));
    choice(order, "NONE", single, null, null, null, null);
  }

  // ---------------------------------------------------------------- composite FKs

  @Test
  void compositeForeignKeys() {
    LocalDate date = day(MENU_CAFE);
    // A category of another cafeteria.
    failure(
        "23503",
        "fk_daily_menu_options_category",
        () -> option(MENU_CAFE, date, otherSingle, "Pollo"));
    // A day without header.
    failure(
        "23503",
        "fk_daily_menu_options_day",
        () -> option(MENU_CAFE, LocalDate.of(2025, 1, 1), single, "Pollo"));
    // An addition of this cafeteria switched on for another cafeteria's day.
    LocalDate other = day(OTHER_CAFE);
    failure(
        "23503",
        "fk_daily_menu_addition_item",
        () ->
            jdbc.update(
                "INSERT INTO public.daily_menu_addition_availability(cafeteria_id,business_date,addition_id,is_available,extra_price) VALUES (?,?,?,true,2000)",
                OTHER_CAFE,
                other,
                addition));
    failure(
        "23503",
        "fk_daily_menu_addition_day",
        () ->
            jdbc.update(
                "INSERT INTO public.daily_menu_addition_availability(cafeteria_id,business_date,addition_id,is_available,extra_price) VALUES (?,DATE '2025-01-01',?,true,2000)",
                MENU_CAFE,
                addition));
    // A menu snapshot pointing at an order of another cafeteria.
    UUID foreign = order(client(), OTHER_CAFE);
    failure(
        "23503",
        "fk_order_daily_menu_order",
        () ->
            jdbc.update(
                "INSERT INTO public.order_daily_menus(order_id,cafeteria_id,business_date,title_snapshot,plate_price) VALUES (?,?,DATE '2026-01-01','Almuerzo del día',9500)",
                foreign,
                MENU_CAFE));
    // A choice without its menu header.
    UUID bare = order(client(), MENU_CAFE);
    failure(
        "23503",
        "fk_choice_order_menu",
        () -> choice(bare, "NONE", single, null, null, null, null));
  }

  @Test
  void publicationNeedsPublisherTitleAndPrice() {
    LocalDate date = day(MENU_CAFE);
    failure(
        "23514",
        "chk_daily_menu_days_publication",
        () ->
            jdbc.update(
                "UPDATE public.daily_menu_days SET published_at=now() WHERE cafeteria_id=? AND business_date=?",
                MENU_CAFE,
                date));
    failure(
        "23514",
        "chk_daily_menu_days_publication",
        () ->
            jdbc.update(
                "UPDATE public.daily_menu_days SET published_at=now(), published_by=? WHERE cafeteria_id=? AND business_date=?",
                WORKER,
                MENU_CAFE,
                date));
  }

  // ---------------------------------------------------------------- immutability

  @Test
  void orderSnapshotsAreImmutable() {
    UUID order = menuOrder();
    choice(order, "NONE", single, null, null, null, null);
    failure(
        "23514",
        "order_daily_menu_immutable",
        () ->
            jdbc.update(
                "UPDATE public.order_daily_menus SET plate_price=1 WHERE order_id=?", order));
    failure(
        "23514",
        "order_daily_menu_immutable",
        () -> jdbc.update("DELETE FROM public.order_daily_menus WHERE order_id=?", order));
    failure(
        "23514",
        "order_daily_menu_immutable",
        () ->
            jdbc.update(
                "UPDATE public.order_daily_menu_choices SET category_label='X' WHERE order_id=?",
                order));
    failure(
        "23514",
        "order_daily_menu_immutable",
        () -> jdbc.update("DELETE FROM public.order_daily_menu_choices WHERE order_id=?", order));
    // The order itself cannot be deleted while its snapshot exists. An ON DELETE RESTRICT
    // foreign key reports 23001 (restrict_violation) on PostgreSQL 18 and 23503
    // (foreign_key_violation) on earlier versions; the constraint name is what proves the block.
    var cause =
        assertThrows(
            DataAccessException.class,
            () -> jdbc.update("DELETE FROM public.orders WHERE id=?", order));
    var restrict = assertInstanceOf(PSQLException.class, cause.getMostSpecificCause());
    assertTrue(Set.of("23001", "23503").contains(restrict.getSQLState()), restrict.getMessage());
    assertNotNull(restrict.getServerErrorMessage());
    assertEquals(
        "fk_order_daily_menu_order",
        restrict.getServerErrorMessage().getConstraint(),
        restrict.getMessage());
  }

  @Test
  void updatedAtFollowsUpdates() {
    jdbc.update(
        "INSERT INTO public.daily_menu_settings(cafeteria_id,plate_price,updated_at) VALUES (?,9500,now() - interval '1 day')",
        OTHER_CAFE);
    jdbc.update(
        "UPDATE public.daily_menu_settings SET plate_price=9800 WHERE cafeteria_id=?", OTHER_CAFE);
    assertTrue(
        jdbc.queryForObject(
            "SELECT updated_at > now() - interval '1 minute' FROM public.daily_menu_settings WHERE cafeteria_id=?",
            Boolean.class,
            OTHER_CAFE));
  }

  // ---------------------------------------------------------------- regression

  @Test
  void earlierOrderRulesStillHold() {
    UUID user = client();
    UUID first = order(user, MENU_CAFE);
    // 020: one active order per client.
    failure("23505", "uq_orders_one_active_per_client", () -> order(user, MENU_CAFE));
    // 011: an order item of another cafeteria's product.
    failure(
        "23503",
        "fk_item_lunch_cafeteria",
        () ->
            jdbc.update(
                "INSERT INTO public.order_items(order_id,cafeteria_id,lunch_id,lunch_name,unit_price,quantity,subtotal) VALUES (?,?,?,'Corriente',13000,1,13000)",
                first,
                MENU_CAFE,
                OTHER_LUNCH));
    failure(
        "23514",
        "chk_item_subtotal",
        () ->
            jdbc.update(
                "INSERT INTO public.order_items(order_id,cafeteria_id,lunch_id,lunch_name,unit_price,quantity,subtotal) VALUES (?,?,?,'Corriente',13000,2,13000)",
                first,
                MENU_CAFE,
                LUNCH));
    // 021: the note is trimmed.
    failure(
        "23514",
        "chk_orders_note",
        () -> jdbc.update("UPDATE public.orders SET note=' sin cebolla' WHERE id=?", first));
    // 030: at most five reminders.
    failure(
        "23514",
        "chk_order_reminder_count",
        () -> jdbc.update("UPDATE public.orders SET reminder_count=6 WHERE id=?", first));
    jdbc.update("UPDATE public.orders SET reminder_count=5 WHERE id=?", first);
    // 021: a rejection keeps its details once it is recorded.
    jdbc.update(
        "UPDATE public.orders SET status='CANCELLED', cancelled_at=now(), cancellation_source='WORKER', rejection_reason='Sin proteína', rejected_by=? WHERE id=?",
        WORKER,
        first);
    failure(
        "23514",
        "orders_cancellation_immutable",
        () ->
            jdbc.update(
                "UPDATE public.orders SET rejection_reason='Otro motivo' WHERE id=?", first));
  }

  // ---------------------------------------------------------------- staging seed

  @Test
  void seedRefusesWithoutStagingTargetAndIsIdempotent() throws Exception {
    var error = assertThrows(SQLException.class, () -> runScript(SEED, false));
    assertTrue(error.getMessage().contains("unifood-staging only"), error.getMessage());
    assertEquals(
        0, count("SELECT count(*) FROM public.daily_menu_settings WHERE cafeteria_id=?", CENTRAL));
    assertEquals(
        0,
        count("SELECT count(*) FROM public.daily_menu_categories WHERE cafeteria_id=?", CENTRAL));

    runScript(SEED, true);
    String first = seedSnapshot();
    runScript(SEED, true);
    assertEquals(first, seedSnapshot(), "A second run must change nothing");

    assertEquals(
        "Almuerzo del día|9500.00",
        jdbc.queryForObject(
            "SELECT title||'|'||plate_price FROM public.daily_menu_settings WHERE cafeteria_id=?",
            String.class,
            CENTRAL));
    assertEquals(
        List.of(
            "0:Proteína:SINGLE:false",
            "1:Principio:SINGLE:false",
            "2:Bebida:SINGLE:true",
            "3:Complementos:SINGLE:true",
            "4:Adiciones:ADDITIONS:true"),
        jdbc.queryForList(
            "SELECT position||':'||label||':'||kind||':'||can_skip FROM public.daily_menu_categories WHERE cafeteria_id=? ORDER BY position",
            String.class,
            CENTRAL));
    assertEquals(
        3, count("SELECT count(*) FROM public.daily_menu_additions WHERE cafeteria_id=?", CENTRAL));
    assertEquals(
        8, count("SELECT count(*) FROM public.daily_menu_options WHERE cafeteria_id=?", CENTRAL));
    assertEquals(
        2,
        count(
            "SELECT count(*) FROM public.daily_menu_addition_availability WHERE cafeteria_id=?",
            CENTRAL));
    assertEquals(
        WORKER + "|1|9500.00",
        jdbc.queryForObject(
            "SELECT published_by||'|'||version||'|'||plate_price_snapshot FROM public.daily_menu_days WHERE cafeteria_id=?",
            String.class,
            CENTRAL));
    // Only the demo cafeteria is seeded.
    assertEquals(
        0,
        count(
            "SELECT count(*) FROM public.daily_menu_days WHERE cafeteria_id <> ? AND business_date >= DATE '2026-06-01'",
            CENTRAL));
  }

  static String seedSnapshot() {
    return jdbc.queryForObject(
        "SELECT jsonb_build_array("
            + "(SELECT jsonb_agg(to_jsonb(s)) FROM public.daily_menu_settings s WHERE cafeteria_id=?),"
            + "(SELECT jsonb_agg(to_jsonb(c) ORDER BY position) FROM public.daily_menu_categories c WHERE cafeteria_id=?),"
            + "(SELECT jsonb_agg(to_jsonb(a) ORDER BY name) FROM public.daily_menu_additions a WHERE cafeteria_id=?),"
            + "(SELECT jsonb_agg(to_jsonb(d)) FROM public.daily_menu_days d WHERE cafeteria_id=?),"
            + "(SELECT jsonb_agg(to_jsonb(o) ORDER BY label) FROM public.daily_menu_options o WHERE cafeteria_id=?),"
            + "(SELECT jsonb_agg(to_jsonb(v) ORDER BY addition_id) FROM public.daily_menu_addition_availability v WHERE cafeteria_id=?)"
            + ")::text",
        String.class,
        CENTRAL,
        CENTRAL,
        CENTRAL,
        CENTRAL,
        CENTRAL,
        CENTRAL);
  }
}

package com.santotofood.adapter.out.persistence;

import static org.junit.jupiter.api.Assertions.*;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.SQLException;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

/**
 * scripts/supabase/fix-daily-menu-template-staging.sql on an isolated local cluster, with its own
 * fixture: every cafeteria ends with the rev. 7 template, or nothing changes at all.
 */
@Timeout(90)
class DailyMenuTemplateFixPostgresTest {
  static final Path FIX = Path.of("../scripts/supabase/fix-daily-menu-template-staging.sql");
  static final UUID OLD = UUID.randomUUID();
  static final UUID EMPTY = UUID.randomUUID();
  static final UUID ODD = UUID.randomUUID();
  static final List<String> TARGET =
      List.of(
          "0:Proteína:SINGLE:false:true",
          "1:Principio:SINGLE:false:true",
          "2:Bebida:SINGLE:true:true",
          "3:Complementos:SINGLE:true:true",
          "4:Adiciones:ADDITIONS:true:true");
  static Process database;
  static JdbcTemplate jdbc;

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

  static void seed() {
    UUID site = UUID.randomUUID();
    jdbc.update(
        "INSERT INTO public.sites(id,name,city,institution_id) SELECT ?,'Sede Principal','Villavicencio',id FROM public.institutions WHERE email_domain='ustavillavo.edu.co'",
        site);
    for (var cafe :
        List.of(
            List.of(OLD, "Cafetería Central"),
            List.of(EMPTY, "Cafetería Norte"),
            List.of(ODD, "Cafetería Rara")))
      jdbc.update(
          "INSERT INTO public.cafeterias(id,site_id,name,is_active,lunch_order_start,lunch_order_end) VALUES (?,?,?,false,'06:00','18:00')",
          cafe.get(0),
          site,
          cafe.get(1));
    // The template seed-daily-menu.sql created before rev. 7.
    jdbc.update(
        "INSERT INTO public.daily_menu_categories(cafeteria_id,label,kind,position,can_skip) VALUES "
            + "(?,'Proteína','SINGLE',0,false),(?,'Principio','SINGLE',1,false),"
            + "(?,'Acompañamientos','SINGLE',2,true),(?,'Complemento','SINGLE',3,true),"
            + "(?,'Adiciones','ADDITIONS',4,true)",
        OLD,
        OLD,
        OLD,
        OLD,
        OLD);
    // A past option keeps Acompañamientos referenced: it can be deactivated, never deleted.
    var yesterday = LocalDate.of(2026, 11, 19);
    jdbc.update(
        "INSERT INTO public.daily_menu_days(cafeteria_id,business_date) VALUES (?,?)",
        OLD,
        yesterday);
    jdbc.update(
        "INSERT INTO public.daily_menu_options(cafeteria_id,business_date,category_id,label) "
            + "SELECT ?,?,id,'Ensalada de tomate' FROM public.daily_menu_categories WHERE cafeteria_id=? AND label='Acompañamientos'",
        OLD,
        yesterday,
        OLD);
    // A template that is neither the old one nor empty.
    jdbc.update(
        "INSERT INTO public.daily_menu_categories(cafeteria_id,label,kind,position,can_skip) VALUES (?,'Proteína','SINGLE',0,false)",
        ODD);
  }

  static void run(boolean stagingTarget) throws Exception {
    try (var connection = jdbc.getDataSource().getConnection();
        var statement = connection.createStatement()) {
      if (stagingTarget) statement.execute("SET unifood.seed_target = 'staging'");
      statement.execute(Files.readString(FIX, StandardCharsets.UTF_8));
    }
  }

  static List<String> template(UUID cafe) {
    return jdbc.queryForList(
        "SELECT position||':'||label||':'||kind||':'||can_skip||':'||active FROM public.daily_menu_categories WHERE cafeteria_id=? ORDER BY position",
        String.class,
        cafe);
  }

  static String everything() {
    return String.join(
        "|",
        jdbc.queryForList(
            "SELECT cafeteria_id||':'||position||':'||label||':'||active FROM public.daily_menu_categories ORDER BY cafeteria_id, position",
            String.class));
  }

  @Test
  void fixesEveryCafeteriaOrChangesNothing() throws Exception {
    String before = everything();

    var target = assertThrows(SQLException.class, () -> run(false));
    assertTrue(target.getMessage().contains("unifood-staging only"), target.getMessage());
    assertEquals(before, everything());

    // One unexpected cafeteria rolls back the whole run, including the ones already fixed.
    var odd = assertThrows(SQLException.class, () -> run(true));
    assertTrue(odd.getMessage().contains("Cafetería Rara: unexpected template"), odd.getMessage());
    assertEquals(before, everything());

    jdbc.update("DELETE FROM public.daily_menu_categories WHERE cafeteria_id=?", ODD);
    run(true);
    assertEquals(
        List.of(
            "0:Proteína:SINGLE:false:true",
            "1:Principio:SINGLE:false:true",
            "2:Bebida:SINGLE:true:true",
            "3:Complementos:SINGLE:true:true",
            "4:Adiciones:ADDITIONS:true:true",
            "90:Acompañamientos:SINGLE:true:false"),
        template(OLD));
    assertEquals(TARGET, template(EMPTY));
    assertEquals(TARGET, template(ODD));
    assertEquals(
        1,
        jdbc.queryForObject(
            "SELECT count(*) FROM public.daily_menu_options WHERE cafeteria_id=?",
            Integer.class,
            OLD),
        "Past options are kept");

    // Not repeatable: a second run fails and changes nothing.
    String fixed = everything();
    var again = assertThrows(SQLException.class, () -> run(true));
    assertTrue(again.getMessage().contains("unexpected template"), again.getMessage());
    assertEquals(fixed, everything());
  }

  @Test
  void noCafeteriasIsAnError() throws Exception {
    // Checked against an empty view of the table inside one rolled-back transaction.
    try (var connection = jdbc.getDataSource().getConnection();
        var statement = connection.createStatement()) {
      connection.setAutoCommit(false);
      statement.execute("SET LOCAL unifood.seed_target = 'staging'");
      String script = Files.readString(FIX, StandardCharsets.UTF_8);
      String body =
          script
              .substring(script.indexOf("DO $$"), script.indexOf("$$;") + 3)
              .replace(
                  "FROM public.cafeterias c ORDER BY",
                  "FROM public.cafeterias c WHERE false ORDER BY");
      var error = assertThrows(SQLException.class, () -> statement.execute(body));
      assertTrue(error.getMessage().contains("No cafeterias found"), error.getMessage());
      connection.rollback();
    }
  }
}

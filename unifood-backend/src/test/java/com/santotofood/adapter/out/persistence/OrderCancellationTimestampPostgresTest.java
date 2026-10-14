package com.santotofood.adapter.out.persistence;

import static org.junit.jupiter.api.Assertions.*;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.*;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.*;
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;
import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

/** Applies 014 to an owned PostgreSQL cluster containing genuine pre-014 terminal rows. */
@Timeout(60)
class OrderCancellationTimestampPostgresTest {
  static final Path MIGRATION = Path.of("supabase/migrations/014_order_cancellation_timestamp.sql");
  static final Instant CANCELLED_AT = Instant.parse("2026-10-13T05:00:00.123456Z");
  static final UUID CAFE = UUID.randomUUID(), LEGACY_CANCELLED = UUID.randomUUID();
  static final UUID LEGACY_DELIVERED = UUID.randomUUID(), ITEM = UUID.randomUUID();
  static Process database;
  static String url, legacyOrdersBefore, legacyItemBefore;

  @BeforeAll
  static void start() throws Exception {
    String bootstrap =
        """
        import { createNativeAuthDatabase, postgresBinaries }
          from '../unifood-web/tests/helpers/native-auth-database.mjs';
        const binaries = await postgresBinaries();
        if (!binaries) throw new Error('Native PostgreSQL required for cancellation timestamps');
        const db = await createNativeAuthDatabase(binaries, { throughMigration: '013' });
        try {
          const port = await db.query('SHOW port');
          console.log(JSON.stringify({ url: `jdbc:postgresql://127.0.0.1:${port}/postgres` }));
          await new Promise(resolve => {
            process.stdin.once('data', resolve); process.stdin.once('end', resolve); process.stdin.resume();
          });
          process.stdin.destroy();
        } finally { await db.close(); }
        """;
    database =
        new ProcessBuilder("node", "--input-type=module", "-e", bootstrap)
            .redirectError(ProcessBuilder.Redirect.INHERIT)
            .start();
    String metadata =
        new BufferedReader(new InputStreamReader(database.getInputStream(), StandardCharsets.UTF_8))
            .readLine();
    assertNotNull(metadata, "Owned PostgreSQL helper failed to start");
    url = metadata.substring(metadata.indexOf("jdbc:"), metadata.lastIndexOf('"'));
    assertTrue(url.startsWith("jdbc:postgresql://127.0.0.1:"));
    seedLegacy();
    assertEquals(
        0,
        integer(
            "SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='cancelled_at'"));
    legacyOrdersBefore = legacyOrders(false);
    legacyItemBefore = text("SELECT to_jsonb(i)::text FROM public.order_items i WHERE id=?", ITEM);
    var beforeAudit = audit();
    for (String field :
        List.of(
            "cancelled_at_column",
            "unexpected_cancellation_column_privilege",
            "unexpected_cancellation_guard_execute"))
      assertTrue(beforeAudit.stream().noneMatch(row -> row.containsKey(field)));
    execute(Files.readString(MIGRATION, StandardCharsets.UTF_8));
    // Assert before any tests update these rows: the migration must not touch any old field.
    assertEquals(legacyOrdersBefore, legacyOrders(true));
    assertEquals(legacyItemBefore, text("SELECT to_jsonb(i)::text FROM public.order_items i WHERE id=?", ITEM));
    assertNull(timestamp(LEGACY_CANCELLED));
    assertNull(timestamp(LEGACY_DELIVERED));
  }

  @AfterAll
  static void stop() throws Exception {
    if (database != null) {
      database.getOutputStream().write("stop\n".getBytes(StandardCharsets.UTF_8));
      database.getOutputStream().flush();
      assertTrue(database.waitFor(30, TimeUnit.SECONDS), "Owned PostgreSQL must shut down");
      assertEquals(0, database.exitValue());
    }
  }

  static Connection connection() throws SQLException {
    return DriverManager.getConnection(url, "postgres", "");
  }

  static void seedLegacy() throws SQLException {
    UUID site = UUID.randomUUID(), lunch = UUID.randomUUID();
    execute(
        "INSERT INTO public.sites(id,name,city,institution_id) SELECT ?,'Cancellation tests','test',id FROM public.institutions LIMIT 1",
        site);
    execute(
        "INSERT INTO public.cafeterias(id,site_id,name,is_active,lunch_order_start,lunch_order_end) VALUES (?,?,'Historical cafeteria',false,'07:00','08:00')",
        CAFE,
        site);
    execute(
        "INSERT INTO public.lunches(id,cafeteria_id,name,price,stock,is_active,category) VALUES (?,?,'Current catalog',9000,3,false,'CORRIENTE')",
        lunch,
        CAFE);
    for (var entry : Map.of(LEGACY_CANCELLED, "CANCELLED", LEGACY_DELIVERED, "DELIVERED").entrySet())
      execute(
          "INSERT INTO public.orders(id,cafeteria_id,client_name,client_document,total,status,created_at,updated_at) VALUES (?,?,'Legacy snapshot','legacy-document',11000,?::public.order_status,'2026-10-12T10:00:00Z','2026-10-12T11:00:00Z')",
          entry.getKey(),
          CAFE,
          entry.getValue());
    execute(
        "INSERT INTO public.order_items(id,order_id,lunch_id,lunch_name,unit_price,quantity,subtotal,note) VALUES (?,?,?,'Historical product',5500,2,11000,'Historical note')",
        ITEM,
        LEGACY_CANCELLED,
        lunch);
  }

  static void bind(PreparedStatement statement, Object... values) throws SQLException {
    for (int index = 0; index < values.length; index++) {
      Object value = values[index];
      if (value == null) statement.setNull(index + 1, Types.TIMESTAMP_WITH_TIMEZONE);
      else if (value instanceof Instant instant)
        statement.setObject(index + 1, instant.atOffset(ZoneOffset.UTC));
      else statement.setObject(index + 1, value);
    }
  }

  static void execute(String sql, Object... values) throws SQLException {
    try (var connection = connection(); var statement = connection.prepareStatement(sql)) {
      bind(statement, values);
      statement.execute();
    }
  }

  static int integer(String sql, Object... values) throws SQLException {
    try (var connection = connection(); var statement = connection.prepareStatement(sql)) {
      bind(statement, values);
      try (var result = statement.executeQuery()) {
        assertTrue(result.next());
        return result.getInt(1);
      }
    }
  }

  static String text(String sql, Object... values) throws SQLException {
    try (var connection = connection(); var statement = connection.prepareStatement(sql)) {
      bind(statement, values);
      try (var result = statement.executeQuery()) {
        assertTrue(result.next());
        return result.getString(1);
      }
    }
  }

  static String legacyOrders(boolean newColumn) throws SQLException {
    return text(
        "SELECT jsonb_agg("
            + (newColumn ? "to_jsonb(o)-'cancelled_at'" : "to_jsonb(o)")
            + " ORDER BY id)::text FROM public.orders o WHERE id IN (?,?)",
        LEGACY_CANCELLED,
        LEGACY_DELIVERED);
  }

  static String snapshot(UUID id) throws SQLException {
    return text("SELECT to_jsonb(o)::text FROM public.orders o WHERE id=?", id);
  }

  static Instant timestamp(UUID id) throws SQLException {
    try (var connection = connection();
        var statement = connection.prepareStatement("SELECT cancelled_at FROM public.orders WHERE id=?")) {
      statement.setObject(1, id);
      try (var result = statement.executeQuery()) {
        assertTrue(result.next());
        OffsetDateTime value = result.getObject(1, OffsetDateTime.class);
        return value == null ? null : value.toInstant();
      }
    }
  }

  static UUID insert(String status, Instant timestamp) throws SQLException {
    UUID id = UUID.randomUUID();
    execute(
        "INSERT INTO public.orders(id,cafeteria_id,client_name,total,status,cancelled_at) VALUES (?,?,'Fixture',1,?::public.order_status,?)",
        id,
        CAFE,
        status,
        timestamp);
    return id;
  }

  static SQLException rejected(org.junit.jupiter.api.function.Executable operation) {
    SQLException error = assertThrows(SQLException.class, operation);
    assertEquals("23514", error.getSQLState());
    return error;
  }

  @Test
  void columnAndGuardHaveThePublishedReadOnlyAuditMetadata() throws Exception {
    assertEquals(
        "timestamp with time zone:YES:<NULL>",
        text(
            "SELECT data_type||':'||is_nullable||':'||coalesce(column_default,'<NULL>') FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='cancelled_at'"));
    String before = text("SELECT jsonb_agg(to_jsonb(o) ORDER BY id)::text FROM public.orders o");
    var rows = audit();
    var schema = rows.stream().filter(row -> row.containsKey("cancelled_at_column")).toList();
    assertEquals(1, schema.size());
    var row = schema.getFirst();
    assertEquals("public.orders.cancelled_at", row.get("cancelled_at_column"));
    assertEquals(true, row.get("cancelled_at_nullable"));
    assertEquals(false, row.get("cancelled_at_has_default"));
    String check = (String) row.get("cancellation_state_constraint");
    assertTrue(check.contains("cancelled_at IS NULL") && check.contains("CANCELLED"));
    assertEquals(true, row.get("cancellation_state_constraint_validated"));
    assertTrue(((String) row.get("cancellation_guard_signature")).endsWith("guard_order_cancellation_timestamp()"));
    assertEquals(false, row.get("cancellation_guard_security_definer"));
    assertTrue(
        Set.of("search_path=", "search_path=\"\"")
            .contains(((List<?>) row.get("cancellation_guard_settings")).getFirst()));
    assertEquals("trg_orders_cancelled_at_guard", row.get("cancellation_guard_trigger"));
    assertEquals(23, ((Number) row.get("cancellation_guard_trigger_type")).intValue());
    assertEquals("O", row.get("cancellation_guard_trigger_enabled"));
    assertEquals(true, row.get("cancellation_guard_trigger_function_matches"));
    assertClosedPermissions(rows);
    assertEquals(before, text("SELECT jsonb_agg(to_jsonb(o) ORDER BY id)::text FROM public.orders o"));
  }

  @Test
  void freshCancelledInsertRequiresAnExplicitInstant() throws SQLException {
    UUID missing = UUID.randomUUID();
    rejected(
        () ->
            execute(
                "INSERT INTO public.orders(id,cafeteria_id,client_name,total,status) VALUES (?,?,'Missing timestamp',1,'CANCELLED')",
                missing,
                CAFE));
    assertEquals(0, integer("SELECT count(*) FROM public.orders WHERE id=?", missing));
    UUID known = insert("CANCELLED", CANCELLED_AT);
    assertEquals(CANCELLED_AT, timestamp(known));
  }

  @Test
  void cancellationTransitionRequiresTheDateInTheSameStatement() throws SQLException {
    UUID id = insert("PENDING", null);
    String before = snapshot(id);
    rejected(() -> execute("UPDATE public.orders SET status='CANCELLED' WHERE id=?", id));
    assertEquals(before, snapshot(id));
    execute("UPDATE public.orders SET status='CANCELLED',cancelled_at=? WHERE id=?", CANCELLED_AT, id);
    assertEquals(CANCELLED_AT, timestamp(id));
    assertEquals("CANCELLED", text("SELECT status::text FROM public.orders WHERE id=?", id));
  }

  @Test
  void aKnownCancellationCannotBeClearedOrChanged() throws SQLException {
    UUID id = insert("CANCELLED", CANCELLED_AT);
    String before = snapshot(id);
    for (Instant value : Arrays.asList(null, CANCELLED_AT.plusSeconds(1))) {
      rejected(() -> execute("UPDATE public.orders SET cancelled_at=? WHERE id=?", value, id));
      assertEquals(before, snapshot(id));
    }
    // An unrelated write, including the version/updated_at triggers, keeps the original instant.
    execute("UPDATE public.orders SET total=2 WHERE id=?", id);
    assertEquals(CANCELLED_AT, timestamp(id));
  }

  @ParameterizedTest
  @ValueSource(strings = {"PENDING", "PREPARING", "READY", "CALLED", "DELIVERED", "NOT_COLLECTED"})
  void nonCancelledStatesCannotCarryACancellationInstant(String status) throws SQLException {
    rejected(() -> insert(status, CANCELLED_AT));
    UUID id = insert(status, null);
    String before = snapshot(id);
    rejected(() -> execute("UPDATE public.orders SET cancelled_at=? WHERE id=?", CANCELLED_AT, id));
    assertEquals(before, snapshot(id));
    assertNull(timestamp(id));
  }

  @Test
  void unknownLegacyCancellationRemainsUnknownAfterUnrelatedUpdates() throws SQLException {
    assertNull(timestamp(LEGACY_CANCELLED));
    execute("UPDATE public.orders SET total=12000 WHERE id=?", LEGACY_CANCELLED);
    assertNull(timestamp(LEGACY_CANCELLED));
    String before = snapshot(LEGACY_CANCELLED);
    rejected(
        () ->
            execute(
                "UPDATE public.orders SET cancelled_at=? WHERE id=?", CANCELLED_AT, LEGACY_CANCELLED));
    assertEquals(before, snapshot(LEGACY_CANCELLED));
    assertNull(timestamp(LEGACY_DELIVERED));
  }

  @Test
  void aFailedTransactionalWriteRollsBackTheTransitionAndItsDate() throws SQLException {
    UUID id = insert("PENDING", null);
    String before = snapshot(id);
    try (var connection = connection()) {
      connection.setAutoCommit(false);
      try (var update =
          connection.prepareStatement(
              "UPDATE public.orders SET status='CANCELLED',cancelled_at=? WHERE id=?")) {
        bind(update, CANCELLED_AT, id);
        assertEquals(1, update.executeUpdate());
      }
      try (var invalid =
          connection.prepareStatement("UPDATE public.orders SET cancelled_at=NULL WHERE id=?")) {
        invalid.setObject(1, id);
        rejected(invalid::executeUpdate);
      }
      connection.rollback();
    }
    assertEquals(before, snapshot(id));
    assertNull(timestamp(id));
  }

  @Test
  void auditDetectsRogueColumnAndFunctionGrantsAndTheMigrationRevokesThem() throws Exception {
    String before = snapshot(LEGACY_CANCELLED);
    try {
      execute(
          "GRANT SELECT(cancelled_at),INSERT(cancelled_at),UPDATE(cancelled_at),REFERENCES(cancelled_at) ON public.orders TO PUBLIC,anon,authenticated");
      execute(
          "GRANT EXECUTE ON FUNCTION public.guard_order_cancellation_timestamp() TO PUBLIC,anon,authenticated");
      var exposed = audit();
      for (String field :
          List.of("unexpected_cancellation_column_privilege", "unexpected_cancellation_guard_execute")) {
        var findings = exposed.stream().filter(row -> row.containsKey(field)).toList();
        assertEquals(field.contains("column") ? 12 : 3, findings.size());
        assertTrue(findings.stream().allMatch(row -> Boolean.TRUE.equals(row.get(field))));
        assertEquals(Set.of("PUBLIC", "anon", "authenticated"),
            new HashSet<>(findings.stream().map(row -> (String) row.get("actor")).toList()));
      }
    } finally {
      // 014 is versioned once. Reuse only its exact REVOKE statements, never reapply its DDL.
      var revocations =
          Pattern.compile("(?is)\\bREVOKE\\s+[^;]+;")
              .matcher(Files.readString(MIGRATION, StandardCharsets.UTF_8));
      int count = 0;
      while (revocations.find()) {
        execute(revocations.group());
        count++;
      }
      assertEquals(2, count);
    }
    assertClosedPermissions(audit());
    assertEquals(before, snapshot(LEGACY_CANCELLED));
  }

  static void assertClosedPermissions(List<Map<String, Object>> rows) {
    for (String field :
        List.of("unexpected_cancellation_column_privilege", "unexpected_cancellation_guard_execute")) {
      var permissions = rows.stream().filter(row -> row.containsKey(field)).toList();
      assertEquals(field.contains("column") ? 12 : 3, permissions.size());
      assertTrue(permissions.stream().allMatch(row -> Boolean.FALSE.equals(row.get(field))));
    }
  }

  @Test
  void auditDistinguishesExplicitlyEmptyAclsFromDefaultPrivileges() throws Exception {
    try {
      execute("REVOKE ALL ON TABLE public.orders FROM postgres,PUBLIC,anon,authenticated");
      execute(
          "REVOKE ALL ON FUNCTION public.guard_order_cancellation_timestamp() FROM postgres,PUBLIC,anon,authenticated");
      assertClosedPermissions(audit());
    } finally {
      execute("GRANT ALL ON TABLE public.orders TO postgres");
      execute("GRANT ALL ON FUNCTION public.guard_order_cancellation_timestamp() TO postgres");
    }
    assertClosedPermissions(audit());
  }

  static List<Map<String, Object>> audit() throws Exception {
    var rows = new ArrayList<Map<String, Object>>();
    String script = Files.readString(Path.of("supabase/audit_business_integrity.sql"), StandardCharsets.UTF_8);
    try (var connection = connection(); var statement = connection.createStatement()) {
      boolean results = statement.execute(script);
      while (true) {
        if (results) {
          try (var result = statement.getResultSet()) {
            while (result.next()) {
              var row = new LinkedHashMap<String, Object>();
              for (int index = 1; index <= result.getMetaData().getColumnCount(); index++) {
                Object value = result.getObject(index);
                if (value instanceof java.sql.Array array) {
                  value = Arrays.asList((Object[]) array.getArray());
                  array.free();
                }
                row.put(result.getMetaData().getColumnLabel(index), value);
              }
              rows.add(row);
            }
          }
        } else if (statement.getUpdateCount() == -1) break;
        results = statement.getMoreResults();
      }
    }
    return rows;
  }
}

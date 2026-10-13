package com.santotofood.adapter.out.persistence;

import static org.junit.jupiter.api.Assertions.*;

import com.santotofood.adapter.out.persistence.entity.LunchEntity;
import com.santotofood.adapter.out.persistence.repository.SpringDataLunchRepository;
import com.santotofood.domain.model.CatalogCategory;
import com.santotofood.domain.model.Lunch;
import jakarta.persistence.EntityManager;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.SQLException;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import org.hibernate.SessionFactory;
import org.hibernate.cfg.Configuration;
import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.springframework.dao.DataAccessException;
import org.springframework.data.jpa.repository.support.JpaRepositoryFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.orm.jpa.JpaTransactionManager;
import org.springframework.orm.jpa.SharedEntityManagerCreator;
import org.springframework.transaction.support.TransactionTemplate;

/** Applies 012 to real legacy data, then exercises the catalog adapter through Hibernate. */
@Timeout(60)
class CatalogCategoriesPostgresTest {
  static Process database;
  static SessionFactory emf;
  static JdbcTemplate jdbc;
  static TransactionTemplate tx;
  static LunchPersistenceAdapter lunches;
  static final UUID CAFE = UUID.randomUUID();
  static final UUID OTHER_CAFE = UUID.randomUUID();
  static final UUID LEGACY = UUID.randomUUID();
  static final UUID ORDER = UUID.randomUUID();
  static final UUID ITEM = UUID.randomUUID();
  static String legacyBefore;
  static String itemBefore;
  static String cafeBefore;
  static List<String> constraintsBefore;

  @BeforeAll
  static void start() throws Exception {
    // Reuse the isolated native bootstrap, stopping at 011 so data predates 012.
    // No external database URL, credentials or remote migration execution.
    String bootstrap =
        """
        import { createNativeAuthDatabase, postgresBinaries }
          from '../unifood-web/tests/helpers/native-auth-database.mjs';
        const binaries = await postgresBinaries();
        if (!binaries) throw new Error('Native PostgreSQL is required for catalog tests');
        const db = await createNativeAuthDatabase(binaries, { throughMigration: '011' });
        try {
          const port = await db.query('SHOW port');
          console.log(JSON.stringify({ url: `jdbc:postgresql://127.0.0.1:${port}/postgres` }));
          await new Promise(resolve => {
            process.stdin.once('data', resolve);
            process.stdin.once('end', resolve);
            process.stdin.resume();
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
    assertNotNull(metadata, "Isolated PostgreSQL helper failed to start");
    String url = metadata.substring(metadata.indexOf("jdbc:"), metadata.lastIndexOf('"'));
    assertTrue(url.startsWith("jdbc:postgresql://127.0.0.1:"));
    var source = new DriverManagerDataSource(url, "postgres", "");
    jdbc = new JdbcTemplate(source);
    seedLegacyData();
    legacyBefore = legacySnapshot();
    itemBefore = itemSnapshot();
    cafeBefore =
        jdbc.queryForObject(
            "SELECT to_jsonb(c)::text FROM public.cafeterias c WHERE id=?", String.class, CAFE);
    constraintsBefore = constraints();
    assertEquals(
        0,
        jdbc.queryForObject(
            "SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='lunches' AND column_name='category'",
            Integer.class));
    assertTrue(auditTypeUsage().isEmpty(), "The read-only audit must also work before 012");
    executeScript(Path.of("supabase/migrations/012_catalog_categories.sql"));
    emf =
        new Configuration()
            .addAnnotatedClass(LunchEntity.class)
            .setProperty("hibernate.connection.url", url)
            .setProperty("hibernate.connection.username", "postgres")
            .setProperty("hibernate.connection.driver_class", "org.postgresql.Driver")
            .setProperty("hibernate.hbm2ddl.auto", "validate")
            .setProperty("hibernate.show_sql", "false")
            .buildSessionFactory();
    tx = new TransactionTemplate(new JpaTransactionManager(emf));
    EntityManager em = SharedEntityManagerCreator.createSharedEntityManager(emf);
    var factory = new JpaRepositoryFactory(em);
    lunches = new LunchPersistenceAdapter(factory.getRepository(SpringDataLunchRepository.class));
  }

  static void seedLegacyData() {
    UUID site = UUID.randomUUID();
    jdbc.update(
        "INSERT INTO public.sites(id,name,city,institution_id) SELECT ?,'Catalog tests','test',id FROM public.institutions LIMIT 1",
        site);
    for (UUID cafe : List.of(CAFE, OTHER_CAFE))
      jdbc.update(
          "INSERT INTO public.cafeterias(id,site_id,name,is_active,service_available,lunch_order_start,lunch_order_end) VALUES (?,?,?,false,false,'07:00','08:00')",
          cafe,
          site,
          cafe.toString());
    jdbc.update(
        "INSERT INTO public.lunches(id,cafeteria_id,name,description,price,image_url,stock,is_active) VALUES (?,?,'Legacy catalog','Keep description',10000,'legacy-image',7,false)",
        LEGACY,
        CAFE);
    jdbc.update(
        "INSERT INTO public.orders(id,cafeteria_id,client_name,total) VALUES (?,?,'Historical client',11000)",
        ORDER,
        CAFE);
    // Legitimate historical snapshot differs from the current catalog name/price.
    jdbc.update(
        "INSERT INTO public.order_items(id,order_id,lunch_id,lunch_name,unit_price,quantity,subtotal,note) VALUES (?,?,?,'Historical name',5500,2,11000,'Keep note')",
        ITEM,
        ORDER,
        LEGACY);
  }

  static void executeScript(Path script) throws Exception {
    try (var connection = jdbc.getDataSource().getConnection();
        var statement = connection.createStatement()) {
      statement.execute(Files.readString(script, StandardCharsets.UTF_8));
    }
  }

  static Map<String, Boolean> auditTypeUsage() throws Exception {
    Map<String, Boolean> permissions = new LinkedHashMap<>();
    try (var connection = jdbc.getDataSource().getConnection();
        var statement = connection.createStatement()) {
      boolean rows =
          statement.execute(
              Files.readString(
                  Path.of("supabase/audit_business_integrity.sql"), StandardCharsets.UTF_8));
      while (true) {
        if (rows) {
          try (var result = statement.getResultSet()) {
            var metadata = result.getMetaData();
            boolean typeAudit = false;
            for (int column = 1; column <= metadata.getColumnCount(); column++)
              if ("unexpected_type_usage".equals(metadata.getColumnLabel(column))) typeAudit = true;
            if (typeAudit)
              while (result.next())
                permissions.put(
                    result.getString("actor"), result.getBoolean("unexpected_type_usage"));
          }
        } else if (statement.getUpdateCount() == -1) break;
        rows = statement.getMoreResults();
      }
    }
    return permissions;
  }

  static String legacySnapshot() {
    return jdbc.queryForObject(
        "SELECT (to_jsonb(l)-'category')::text FROM public.lunches l WHERE id=?",
        String.class,
        LEGACY);
  }

  static String itemSnapshot() {
    return jdbc.queryForObject(
        "SELECT to_jsonb(i)::text FROM public.order_items i WHERE id=?", String.class, ITEM);
  }

  static List<String> constraints() {
    return jdbc.queryForList(
        "SELECT conname||':'||pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid IN ('public.lunches'::regclass,'public.orders'::regclass,'public.order_items'::regclass) ORDER BY conname",
        String.class);
  }

  static void sqlFailure(String state, Runnable action) {
    var error = assertThrows(DataAccessException.class, action::run);
    assertInstanceOf(SQLException.class, error.getMostSpecificCause());
    assertEquals(state, ((SQLException) error.getMostSpecificCause()).getSQLState());
  }

  @AfterAll
  static void stop() throws Exception {
    if (emf != null) emf.close();
    if (database != null && database.isAlive()) {
      database.getOutputStream().write("stop\n".getBytes(StandardCharsets.UTF_8));
      database.getOutputStream().flush();
      assertTrue(
          database.waitFor(30, TimeUnit.SECONDS), "PostgreSQL helper must close its owned cluster");
      assertEquals(0, database.exitValue());
    }
  }

  @Test
  void enumContainsExactlyTheFiveApprovedCategories() {
    var expected = List.of("DEL_DIA", "CORRIENTE", "EJECUTIVO", "ESPECIAL", "DESAYUNO");
    assertEquals(
        expected,
        jdbc.queryForList(
            "SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typname='catalog_category' ORDER BY e.enumsortorder",
            String.class));
    assertEquals(expected, Arrays.stream(CatalogCategory.values()).map(Enum::name).toList());
  }

  @Test
  void columnIsNullableWithoutAnImplicitClassificationDefault() {
    assertFalse(
        jdbc.queryForObject(
            "SELECT a.attnotnull FROM pg_attribute a WHERE a.attrelid='public.lunches'::regclass AND a.attname='category'",
            Boolean.class));
    assertEquals(
        0,
        jdbc.queryForObject(
            "SELECT count(*) FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum WHERE a.attrelid='public.lunches'::regclass AND a.attname='category'",
            Integer.class));
    assertNull(
        jdbc.queryForObject(
            "SELECT category::text FROM public.lunches WHERE id=?", String.class, LEGACY));
    UUID fresh = UUID.randomUUID();
    jdbc.update(
        "INSERT INTO public.lunches(id,cafeteria_id,name,price) VALUES (?,?,?,1)",
        fresh,
        CAFE,
        fresh.toString());
    assertNull(
        jdbc.queryForObject(
            "SELECT category::text FROM public.lunches WHERE id=?", String.class, fresh));
  }

  @Test
  void migrationPreservesLegacyRowsSnapshotsAndAllExistingConstraints() {
    assertEquals(legacyBefore, legacySnapshot());
    assertEquals(itemBefore, itemSnapshot());
    assertEquals(
        cafeBefore,
        jdbc.queryForObject(
            "SELECT to_jsonb(c)::text FROM public.cafeterias c WHERE id=?", String.class, CAFE));
    assertEquals(constraintsBefore, constraints());
    var legacy = tx.execute(status -> lunches.findById(LEGACY).orElseThrow());
    assertNull(legacy.getCategory());
    assertFalse(legacy.isActive());
    assertEquals(7, legacy.getStock());
    assertEquals(0, BigDecimal.valueOf(10000).compareTo(legacy.getPrice()));
  }

  @ParameterizedTest
  @EnumSource(CatalogCategory.class)
  void everyEnumValueRoundTripsThroughTheRealJpaAdapter(CatalogCategory category) {
    UUID id = UUID.randomUUID();
    var product =
        Lunch.reconstitute(
            id,
            CAFE,
            id.toString(),
            "Classified fixture",
            BigDecimal.TEN,
            null,
            3,
            false,
            category);
    tx.executeWithoutResult(status -> lunches.save(product));
    assertEquals(
        category.name(),
        jdbc.queryForObject(
            "SELECT category::text FROM public.lunches WHERE id=?", String.class, id));
    var loaded = tx.execute(status -> lunches.findById(id).orElseThrow());
    assertEquals(category, loaded.getCategory());
    assertFalse(loaded.isActive());
    assertEquals(3, loaded.getStock());
    assertEquals(id, loaded.getId());
    assertEquals(CAFE, loaded.getCafeteriaId());
  }

  @Test
  void nullCategoryCanBeWrittenReadAndExplicitlyClassifiedWithoutChangingHistory() {
    UUID id = UUID.randomUUID(), item = UUID.randomUUID();
    var pending =
        Lunch.reconstitute(id, CAFE, id.toString(), null, BigDecimal.TEN, null, 0, false, null);
    tx.executeWithoutResult(status -> lunches.save(pending));
    assertNull(tx.execute(status -> lunches.findById(id).orElseThrow()).getCategory());
    jdbc.update(
        "INSERT INTO public.order_items(id,order_id,lunch_id,lunch_name,unit_price,quantity,subtotal) VALUES (?,?,?,'Old snapshot',5,1,5)",
        item,
        ORDER,
        id);
    String snapshot =
        jdbc.queryForObject(
            "SELECT to_jsonb(i)::text FROM public.order_items i WHERE id=?", String.class, item);
    var classified =
        Lunch.reconstitute(
            id,
            CAFE,
            pending.getName(),
            null,
            BigDecimal.TEN,
            null,
            0,
            false,
            CatalogCategory.DEL_DIA);
    tx.executeWithoutResult(status -> lunches.save(classified));
    assertEquals(
        CatalogCategory.DEL_DIA,
        tx.execute(status -> lunches.findById(id).orElseThrow()).getCategory());
    assertEquals(
        snapshot,
        jdbc.queryForObject(
            "SELECT to_jsonb(i)::text FROM public.order_items i WHERE id=?", String.class, item));
    assertFalse(tx.execute(status -> lunches.findById(id).orElseThrow()).isAvailable());
  }

  @Test
  void unknownCategoryIsRejectedInsteadOfBeingCoerced() {
    sqlFailure(
        "22P02",
        () ->
            jdbc.update(
                "UPDATE public.lunches SET category=?::public.catalog_category WHERE id=?",
                "ALMUERZO",
                LEGACY));
    assertNull(
        jdbc.queryForObject(
            "SELECT category::text FROM public.lunches WHERE id=?", String.class, LEGACY));
  }

  @Test
  void post011CompositeForeignKeysAndSubtotalStillRejectInvalidItems() {
    UUID otherLunch = UUID.randomUUID();
    jdbc.update(
        "INSERT INTO public.lunches(id,cafeteria_id,name,price) VALUES (?,?,?,1)",
        otherLunch,
        OTHER_CAFE,
        otherLunch.toString());
    sqlFailure(
        "23503",
        () ->
            jdbc.update(
                "INSERT INTO public.order_items(order_id,lunch_id,lunch_name,unit_price,quantity,subtotal) VALUES (?,?,'Wrong cafe',1,1,1)",
                ORDER,
                otherLunch));
    sqlFailure(
        "23503",
        () ->
            jdbc.update(
                "INSERT INTO public.order_items(order_id,lunch_id,cafeteria_id,lunch_name,unit_price,quantity,subtotal) VALUES (?,?,?,'Wrong order key',1,1,1)",
                ORDER,
                LEGACY,
                OTHER_CAFE));
    sqlFailure(
        "23514",
        () ->
            jdbc.update(
                "INSERT INTO public.order_items(order_id,lunch_id,lunch_name,unit_price,quantity,subtotal) VALUES (?,?,'Wrong subtotal',1,2,1)",
                ORDER,
                LEGACY));
    sqlFailure(
        "23503",
        () ->
            jdbc.update("UPDATE public.lunches SET cafeteria_id=? WHERE id=?", OTHER_CAFE, LEGACY));
    assertEquals(itemBefore, itemSnapshot());
  }

  @Test
  void browserTableAndColumnPermissionsRemainClosedIncludingCategory() {
    for (String actor : List.of("anon", "authenticated")) {
      for (String privilege :
          List.of("SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"))
        assertFalse(
            jdbc.queryForObject(
                "SELECT has_table_privilege(?,'public.lunches',?)",
                Boolean.class,
                actor,
                privilege));
      for (String privilege : List.of("SELECT", "INSERT", "UPDATE", "REFERENCES")) {
        assertFalse(
            jdbc.queryForObject(
                "SELECT has_any_column_privilege(?,'public.lunches',?)",
                Boolean.class,
                actor,
                privilege));
        assertFalse(
            jdbc.queryForObject(
                "SELECT has_column_privilege(?,'public.lunches','category',?)",
                Boolean.class,
                actor,
                privilege));
      }
      assertFalse(
          jdbc.queryForObject(
              "SELECT has_function_privilege(?,'public.derive_order_item_cafeteria()','EXECUTE')",
              Boolean.class,
              actor));
      sqlFailure(
          "42501",
          () -> jdbc.execute("SET ROLE " + actor + "; SELECT category FROM public.lunches;"));
    }
    assertTrue(
        jdbc.queryForObject(
            "SELECT relrowsecurity FROM pg_class WHERE oid='public.lunches'::regclass",
            Boolean.class));
    assertEquals(
        0,
        jdbc.queryForObject(
            "SELECT count(*) FROM pg_policy WHERE polrelid='public.lunches'::regclass",
            Integer.class));
  }

  @Test
  void typeUsageIsClosedForPublicAndBrowserRolesWhileBackendRetainsOwnerAccess() {
    // PUBLIC is not a pg_roles entry; its effective ACL privilege is grantee 0.
    assertFalse(
        jdbc.queryForObject(
            """
        SELECT EXISTS (
          SELECT 1 FROM pg_type t
          CROSS JOIN LATERAL aclexplode(COALESCE(t.typacl,acldefault('T',t.typowner))) p
          WHERE t.oid='public.catalog_category'::regtype
            AND p.grantee=0 AND p.privilege_type='USAGE'
        )
        """,
            Boolean.class));
    for (String actor : List.of("anon", "authenticated"))
      assertFalse(
          jdbc.queryForObject(
              "SELECT has_type_privilege(?,'public.catalog_category','USAGE')",
              Boolean.class,
              actor));
    String backendRole = jdbc.queryForObject("SELECT current_user", String.class);
    assertEquals("postgres", backendRole);
    assertEquals(
        backendRole,
        jdbc.queryForObject(
            "SELECT pg_get_userbyid(typowner) FROM pg_type WHERE oid='public.catalog_category'::regtype",
            String.class));
    assertTrue(
        jdbc.queryForObject(
            "SELECT rolsuper FROM pg_roles WHERE rolname=current_user", Boolean.class));
    assertTrue(
        jdbc.queryForObject(
            "SELECT has_type_privilege(current_user,'public.catalog_category','USAGE')",
            Boolean.class));
  }

  @Test
  void existingReadOnlyAuditCoversTheNewColumnWithoutSchemaChanges() throws Exception {
    assertEquals(Map.of("PUBLIC", false, "anon", false, "authenticated", false), auditTypeUsage());
    assertEquals(legacyBefore, legacySnapshot());
    assertEquals(itemBefore, itemSnapshot());
    assertEquals(constraintsBefore, constraints());
  }

  @Test
  void readOnlyAuditDetectsReintroducedPublicAndIndividualTypeUsage() throws Exception {
    var closed = Map.of("PUBLIC", false, "anon", false, "authenticated", false);
    assertEquals(closed, auditTypeUsage());
    // Deliberately reopen only this isolated test cluster, then always restore it.
    try {
      jdbc.execute("GRANT USAGE ON TYPE public.catalog_category TO PUBLIC");
      assertEquals(Map.of("PUBLIC", true, "anon", true, "authenticated", true), auditTypeUsage());
      jdbc.execute("REVOKE USAGE ON TYPE public.catalog_category FROM PUBLIC");
      jdbc.execute("GRANT USAGE ON TYPE public.catalog_category TO anon");
      assertEquals(Map.of("PUBLIC", false, "anon", true, "authenticated", false), auditTypeUsage());
      jdbc.execute("REVOKE USAGE ON TYPE public.catalog_category FROM anon");
      jdbc.execute("GRANT USAGE ON TYPE public.catalog_category TO authenticated");
      assertEquals(Map.of("PUBLIC", false, "anon", false, "authenticated", true), auditTypeUsage());
    } finally {
      jdbc.execute("REVOKE USAGE ON TYPE public.catalog_category FROM PUBLIC, anon, authenticated");
    }
    assertEquals(closed, auditTypeUsage());
    assertEquals(legacyBefore, legacySnapshot());
    assertEquals(itemBefore, itemSnapshot());
  }
}

package com.santotofood.adapter.out.persistence;

import static org.junit.jupiter.api.Assertions.*;

import com.santotofood.adapter.out.persistence.entity.OrderEntity;
import com.santotofood.adapter.out.persistence.entity.OrderItemEntity;
import com.santotofood.adapter.out.persistence.mapper.OrderItemMapper;
import com.santotofood.adapter.out.persistence.mapper.OrderMapper;
import com.santotofood.adapter.out.persistence.repository.SpringDataOrderItemRepository;
import com.santotofood.adapter.out.persistence.repository.SpringDataOrderRepository;
import com.santotofood.application.exception.OrderProcessingSequenceException;
import com.santotofood.application.service.OrderService;
import com.santotofood.domain.exception.DomainException;
import com.santotofood.domain.model.Order;
import com.santotofood.shared.error.ErrorCode;
import jakarta.persistence.EntityManager;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.sql.*;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.concurrent.*;
import org.hibernate.SessionFactory;
import org.hibernate.cfg.Configuration;
import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.data.jpa.repository.support.JpaRepositoryFactory;
import org.springframework.orm.jpa.EntityManagerFactoryUtils;
import org.springframework.orm.jpa.JpaTransactionManager;
import org.springframework.orm.jpa.SharedEntityManagerCreator;
import org.springframework.transaction.support.TransactionTemplate;

/** Real migrations, PostgreSQL, Hibernate, Spring Data adapters and service. No mocked writes. */
class OrderConcurrencyPostgresTest {
  static Process database;
  static String url;
  static SessionFactory emf;
  static TransactionTemplate tx;
  static OrderPersistenceAdapter orders;
  static OrderService service;
  static final Instant NOW = Instant.parse("2026-10-10T12:00:00Z");

  @Test
  void deliveredListingUsesItsTerminalBusinessDayAndRolloverPreservesHistory() throws Exception {
    UUID cafe = cafeteria();
    UUID today = order(cafe, "DELIVERED", 0),
        old = order(cafe, "DELIVERED", 1),
        future = order(cafe, "DELIVERED", 2),
        legacy = order(cafe, "DELIVERED", 3),
        pending = order(cafe, "PENDING", 4);
    UUID preparing = order(cafe, "PREPARING", 5),
        ready = order(cafe, "READY", 6),
        called = order(cafe, "CALLED", 7);
    UUID notCollected = order(cafe, "NOT_COLLECTED", 8), cancelled = order(cafe, "PENDING", 9);
    sql(
        "UPDATE public.orders SET not_collected_at='2026-09-13T12:00:00Z' WHERE id='"
            + notCollected
            + "'");
    sql(
        "UPDATE public.orders SET status='CANCELLED',cancelled_at='2026-09-13T12:00:00Z' WHERE id='"
            + cancelled
            + "'");
    sql(
        "UPDATE public.orders SET delivered_at='2026-10-10T05:00:00Z', created_at='2025-01-01',updated_at='2026-09-01' WHERE id='"
            + today
            + "'");
    sql("UPDATE public.orders SET delivered_at='2026-09-13T12:00:00Z' WHERE id='" + old + "'");
    sql("UPDATE public.orders SET delivered_at='2026-10-11T05:00:00Z' WHERE id='" + future + "'");
    var listing = tx.execute(s -> service.getOperationalOrders(cafe));
    assertNotNull(listing);
    assertEquals(java.time.LocalDate.of(2026, 10, 10), listing.businessDate().value());
    assertEquals(
        Set.of(today, pending, preparing, ready, called),
        listing.orders().stream().map(Order::getId).collect(java.util.stream.Collectors.toSet()));
    var newDay =
        tx.execute(
            s ->
                orders.findOperational(
                    cafe,
                    Instant.parse("2026-10-11T05:00:00Z"),
                    Instant.parse("2026-10-12T05:00:00Z")));
    assertEquals(
        Set.of(future, pending, preparing, ready, called),
        newDay.stream().map(Order::getId).collect(java.util.stream.Collectors.toSet()));
    assertNotNull(tx.execute(s -> orders.findById(old).orElseThrow()));
    assertNotNull(tx.execute(s -> orders.findById(legacy).orElseThrow()));
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
    url = metadata.substring(metadata.indexOf("jdbc:"), metadata.lastIndexOf('"'));
    emf =
        new Configuration()
            .addAnnotatedClass(OrderEntity.class)
            .addAnnotatedClass(OrderItemEntity.class)
            .setProperty("hibernate.connection.url", url)
            .setProperty("hibernate.connection.username", "postgres")
            .setProperty("hibernate.connection.driver_class", "org.postgresql.Driver")
            .setProperty("hibernate.hbm2ddl.auto", "validate")
            .setProperty("hibernate.show_sql", "false")
            .setProperty("hibernate.connection.pool_size", "8")
            .buildSessionFactory();
    tx = new TransactionTemplate(new JpaTransactionManager(emf));
    EntityManager em = SharedEntityManagerCreator.createSharedEntityManager(emf);
    JpaRepositoryFactory factory = new JpaRepositoryFactory(em);
    orders =
        new OrderPersistenceAdapter(
            factory.getRepository(SpringDataOrderRepository.class), new OrderMapper());
    var items =
        new OrderItemPersistenceAdapter(
            factory.getRepository(SpringDataOrderItemRepository.class), new OrderItemMapper());
    service = new OrderService(orders, items, () -> NOW);
  }

  @AfterAll
  static void stop() throws Exception {
    if (emf != null) emf.close();
    if (database != null) {
      database.getOutputStream().write("stop\n".getBytes(StandardCharsets.UTF_8));
      database.getOutputStream().flush();
      assertTrue(
          database.waitFor(30, TimeUnit.SECONDS), "PostgreSQL helper must close its owned cluster");
      assertEquals(0, database.exitValue());
    }
  }

  static UUID cafeteria() throws Exception {
    UUID site = UUID.randomUUID(), cafe = UUID.randomUUID();
    sql(
        "INSERT INTO public.sites(id,name,city,institution_id) SELECT '"
            + site
            + "','"
            + site
            + "','test',id FROM public.institutions LIMIT 1");
    sql(
        "INSERT INTO public.cafeterias(id,site_id,name,is_active,lunch_order_start,lunch_order_end) VALUES ('"
            + cafe
            + "','"
            + site
            + "','test',false,'07:00','08:00')");
    return cafe;
  }

  static UUID order(UUID cafe, String state, int offset) throws Exception {
    UUID id = UUID.randomUUID();
    sql(
        "INSERT INTO public.orders(id,cafeteria_id,client_name,total,status,created_at,called_at,reminder_count) VALUES ('"
            + id
            + "','"
            + cafe
            + "','fixture',1,'"
            + state
            + "','2026-10-10T10:00:00Z'::timestamptz + interval '"
            + offset
            + " second', '2026-10-10T11:00:00Z',3)");
    return id;
  }

  static void sql(String sql) throws Exception {
    try (Connection c = DriverManager.getConnection(url, "postgres", "");
        Statement s = c.createStatement()) {
      s.execute(sql);
    }
  }

  static String state(UUID id) {
    return tx.execute(s -> orders.findById(id).orElseThrow().getStatus().name());
  }

  static void assertCancelledAt(UUID id, Instant expected) throws SQLException {
    Order saved = tx.execute(s -> orders.findById(id).orElseThrow());
    assertEquals(
        expected, saved.getCancelledAt(), "Hibernate must round-trip the terminal instant");
    try (Connection connection = DriverManager.getConnection(url, "postgres", "");
        PreparedStatement query =
            connection.prepareStatement("SELECT cancelled_at FROM public.orders WHERE id=?")) {
      query.setObject(1, id);
      try (ResultSet result = query.executeQuery()) {
        assertTrue(result.next());
        OffsetDateTime timestamp = result.getObject(1, OffsetDateTime.class);
        assertEquals(expected, timestamp == null ? null : timestamp.toInstant());
      }
    }
  }

  static Order mutate(UUID id, String action) {
    return tx.execute(s -> transition(id, action));
  }

  static Order transition(UUID id, String action) {
    return switch (action) {
      case "prepare" -> service.prepareOrder(id);
      case "ready" -> service.markOrderReady(id);
      case "call" -> service.callStudent(id);
      case "deliver" -> service.deliverOrder(id);
      case "not-collected" -> service.markOrderNotCollected(id);
      case "cancel" -> service.cancelOwnOrder(id);
      case "worker-cancel" -> service.cancelOrder(id);
      case "remind" -> service.remindStudent(id);
      default -> throw new AssertionError(action);
    };
  }

  static Object observedMutation(
      UUID id, String action, String label, CountDownLatch written, CountDownLatch allowCommit) {
    try {
      return tx.execute(
          s -> {
            EntityManager current = EntityManagerFactoryUtils.getTransactionalEntityManager(emf);
            assertNotNull(current);
            current
                .createNativeQuery("SET LOCAL application_name = '" + label + "'")
                .executeUpdate();
            current.createNativeQuery("SET LOCAL lock_timeout = '15s'").executeUpdate();
            current.createNativeQuery("SET LOCAL statement_timeout = '20s'").executeUpdate();
            Order changed = transition(id, action);
            if (written != null) {
              written.countDown();
              try {
                assertTrue(
                    allowCommit.await(20, TimeUnit.SECONDS), "Winner must be released to commit");
              } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new AssertionError(e);
              }
            }
            return changed;
          });
    } catch (DomainException conflict) {
      return conflict;
    }
  }

  static void awaitDatabaseWait(String label, String relation) throws Exception {
    long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
    while (System.nanoTime() < deadline) {
      try (Connection c = DriverManager.getConnection(url, "postgres", "");
          PreparedStatement query =
              c.prepareStatement(
                  "SELECT count(*) FROM pg_stat_activity WHERE application_name=? AND wait_event_type='Lock' AND query LIKE ?")) {
        query.setString(1, label);
        query.setString(2, "%" + relation + "%");
        try (ResultSet result = query.executeQuery()) {
          result.next();
          if (result.getInt(1) > 0) return;
        }
      }
      // Polling a database predicate; elapsed time alone never establishes the race.
      Thread.sleep(20);
    }
    fail("The competing transaction must be observed waiting on " + relation);
  }

  static List<Object> race(
      UUID firstId,
      String firstAction,
      UUID secondId,
      String secondAction,
      String relation,
      Runnable whileBlocked)
      throws Exception {
    String label = "order-race-" + UUID.randomUUID();
    CountDownLatch written = new CountDownLatch(1), commit = new CountDownLatch(1);
    try (var pool = Executors.newFixedThreadPool(2)) {
      try {
        var first =
            pool.submit(
                () -> observedMutation(firstId, firstAction, label + "-winner", written, commit));
        assertTrue(
            written.await(10, TimeUnit.SECONDS), "First transition must flush before competition");
        var second = pool.submit(() -> observedMutation(secondId, secondAction, label, null, null));
        awaitDatabaseWait(label, relation);
        whileBlocked.run();
        commit.countDown();
        return List.of(first.get(20, TimeUnit.SECONDS), second.get(20, TimeUnit.SECONDS));
      } finally {
        commit.countDown();
      }
    }
  }

  @Test
  @Timeout(60)
  void differentOrdersInTheSameCafeteriaCannotBypassTheUncommittedFifoWinner() throws Exception {
    UUID cafe = cafeteria(), first = order(cafe, "PENDING", 0), second = order(cafe, "PENDING", 1);
    List<Object> results =
        race(
            first,
            "prepare",
            second,
            "prepare",
            "cafeterias",
            () -> {
              assertEquals("PENDING", state(first), "First transition is not committed yet");
              assertEquals(
                  "PENDING", state(second), "Second worker must not jump the reserved queue");
            });
    assertEquals("PREPARING", assertInstanceOf(Order.class, results.get(0)).getStatus().name());
    assertEquals("PREPARING", assertInstanceOf(Order.class, results.get(1)).getStatus().name());
    for (UUID id : List.of(first, second)) {
      Order saved = tx.execute(s -> orders.findById(id).orElseThrow());
      assertEquals("PREPARING", saved.getStatus().name());
      assertEquals(1L, saved.getRevision());
    }
  }

  @Test
  @Timeout(60)
  void concurrentRemindersPersistOnlyOneValidIncrementWithoutStaleOverwrite() throws Exception {
    UUID id = order(cafeteria(), "CALLED", 0);
    sql("UPDATE public.orders SET reminder_count=0 WHERE id='" + id + "'");
    Long previousRevision = tx.execute(s -> orders.findById(id).orElseThrow().getRevision());
    List<Object> results =
        race(
            id,
            "remind",
            id,
            "remind",
            "orders",
            () -> {
              Order uncommitted = tx.execute(s -> orders.findById(id).orElseThrow());
              assertEquals(0, uncommitted.getReminderCount());
            });
    assertEquals(1, assertInstanceOf(Order.class, results.get(0)).getReminderCount());
    assertEquals(
        ErrorCode.REMINDER_TOO_EARLY,
        assertInstanceOf(DomainException.class, results.get(1)).getCode());
    Order saved = tx.execute(s -> orders.findById(id).orElseThrow());
    assertEquals("CALLED", saved.getStatus().name());
    assertEquals(1, saved.getReminderCount());
    assertEquals(NOW, saved.getLastRemindedAt());
    assertEquals(previousRevision + 1, saved.getRevision());
  }

  @ParameterizedTest
  @org.junit.jupiter.params.provider.ValueSource(strings = {"deliver", "not-collected"})
  @Timeout(60)
  void opposingConcurrentTerminalTransitionsHaveOneWinnerAndCannotOverwriteIt(String winner)
      throws Exception {
    UUID id = order(cafeteria(), "CALLED", 0);
    String loser = winner.equals("deliver") ? "not-collected" : "deliver";
    List<Object> results =
        race(id, winner, id, loser, "orders", () -> assertEquals("CALLED", state(id)));
    Order changed = assertInstanceOf(Order.class, results.get(0));
    assertEquals(
        ErrorCode.INVALID_ORDER_STATE,
        assertInstanceOf(DomainException.class, results.get(1)).getCode());
    Order saved = tx.execute(s -> orders.findById(id).orElseThrow());
    assertEquals(
        winner.equals("deliver") ? "DELIVERED" : "NOT_COLLECTED", saved.getStatus().name());
    assertEquals(changed.getStatus(), saved.getStatus());
    assertEquals(1L, saved.getRevision());
    assertEquals(winner.equals("deliver") ? NOW : null, saved.getDeliveredAt());
    assertEquals(winner.equals("not-collected") ? NOW : null, saved.getNotCollectedAt());
    assertCancelledAt(id, null);
    assertThrows(DomainException.class, () -> mutate(id, loser));
    assertEquals(saved.getStatus().name(), state(id));
  }

  @Test
  void cancellationOfPendingWinsBeforePrepareArbitrationAndTheWorkerCannotOverwriteIt()
      throws Exception {
    UUID cafe = cafeteria(), id = order(cafe, "PENDING", 0);
    try (var workers = Executors.newSingleThreadExecutor();
        Connection gate = DriverManager.getConnection(url, "postgres", "")) {
      gate.setAutoCommit(false);
      gate.createStatement()
          .execute("SELECT id FROM public.cafeterias WHERE id='" + cafe + "' FOR UPDATE");
      Future<Throwable> worker =
          workers.submit(
              () -> {
                try {
                  mutate(id, "prepare");
                  return null;
                } catch (Throwable e) {
                  return e;
                }
              });
      // Observe a real database wait after the projection, before arbitration. No timing sleeps as
      // evidence.
      long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
      boolean waiting = false;
      while (System.nanoTime() < deadline) {
        try (Connection probe = DriverManager.getConnection(url, "postgres", "");
            var s = probe.createStatement();
            var r =
                s.executeQuery(
                    "SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%cafeterias%FOR UPDATE%'")) {
          r.next();
          if (r.getInt(1) > 0) {
            waiting = true;
            break;
          }
        }
        Thread.sleep(20);
      }
      assertTrue(
          waiting, "Prepare must be competing while the authoritative order remains PENDING");
      mutate(id, "cancel");
      assertEquals("CANCELLED", state(id));
      assertCancelledAt(id, NOW);
      gate.commit();
      DomainException conflict =
          assertInstanceOf(DomainException.class, worker.get(10, TimeUnit.SECONDS));
      assertEquals(ErrorCode.ORDER_CANCELLED_BY_CLIENT, conflict.getCode());
      assertEquals("CANCELLED", state(id));
      assertCancelledAt(id, NOW);
    }
  }

  @Test
  void committedPreparationRejectsLateClientCancellation() throws Exception {
    UUID id = order(cafeteria(), "PENDING", 0);
    mutate(id, "prepare");
    DomainException error = assertThrows(DomainException.class, () -> mutate(id, "cancel"));
    assertEquals(ErrorCode.ORDER_ALREADY_PREPARING, error.getCode());
    assertEquals("PREPARING", state(id));
    assertCancelledAt(id, null);
  }

  @Test
  @Timeout(60)
  void preparationWinnerLeavesNoCancellationTimestampWhenTheBlockedClientLoses() throws Exception {
    UUID id = order(cafeteria(), "PENDING", 0);
    List<Object> results =
        race(id, "prepare", id, "cancel", "orders", () -> assertEquals("PENDING", state(id)));
    assertEquals("PREPARING", assertInstanceOf(Order.class, results.getFirst()).getStatus().name());
    assertEquals(
        ErrorCode.ORDER_ALREADY_PREPARING,
        assertInstanceOf(DomainException.class, results.get(1)).getCode());
    assertEquals("PREPARING", state(id));
    assertCancelledAt(id, null);
    Long revision = tx.execute(s -> orders.findById(id).orElseThrow().getRevision());
    assertEquals(1L, revision.longValue());
  }

  @Test
  void cafeteriaChangeDuringQueueWaitCannotPrepareUnderTheWrongFifoLock() throws Exception {
    UUID oldCafe = cafeteria(), newCafe = cafeteria(), id = order(oldCafe, "PENDING", 0);
    try (var workers = Executors.newSingleThreadExecutor();
        Connection gate = DriverManager.getConnection(url, "postgres", "")) {
      gate.setAutoCommit(false);
      gate.createStatement()
          .execute("SELECT id FROM public.cafeterias WHERE id='" + oldCafe + "' FOR UPDATE");
      Future<Throwable> worker =
          workers.submit(
              () -> {
                try {
                  mutate(id, "prepare");
                  return null;
                } catch (Throwable e) {
                  return e;
                }
              });
      long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
      boolean waiting = false;
      while (System.nanoTime() < deadline) {
        try (Connection probe = DriverManager.getConnection(url, "postgres", "");
            var s = probe.createStatement();
            var r =
                s.executeQuery(
                    "SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%cafeterias%FOR UPDATE%'")) {
          r.next();
          if (r.getInt(1) > 0) {
            waiting = true;
            break;
          }
        }
        Thread.sleep(20);
      }
      assertTrue(waiting);
      sql("UPDATE public.orders SET cafeteria_id='" + newCafe + "' WHERE id='" + id + "'");
      gate.commit();
      DomainException conflict =
          assertInstanceOf(DomainException.class, worker.get(10, TimeUnit.SECONDS));
      assertEquals(ErrorCode.ORDER_CONCURRENT_MODIFICATION, conflict.getCode());
      assertEquals("PENDING", state(id));
    }
  }

  @ParameterizedTest
  @CsvSource({
    "PENDING,prepare,PREPARING",
    "PENDING,cancel,CANCELLED",
    "PENDING,worker-cancel,CANCELLED",
    "PREPARING,ready,READY",
    "READY,call,CALLED",
    "CALLED,deliver,DELIVERED",
    "CALLED,not-collected,NOT_COLLECTED"
  })
  void duplicateConcurrentTransitionsHaveExactlyOneWinner(
      String before, String action, String after) throws Exception {
    UUID id = order(cafeteria(), before, 0);
    CountDownLatch start = new CountDownLatch(1);
    try (var pool = Executors.newFixedThreadPool(2)) {
      Callable<Object> run =
          () -> {
            start.await();
            try {
              return mutate(id, action);
            } catch (DomainException e) {
              return e;
            }
          };
      var a = pool.submit(run);
      var b = pool.submit(run);
      start.countDown();
      List<Object> results = List.of(a.get(15, TimeUnit.SECONDS), b.get(15, TimeUnit.SECONDS));
      assertEquals(1, results.stream().filter(Order.class::isInstance).count());
      assertEquals(1, results.stream().filter(DomainException.class::isInstance).count());
      assertEquals(after, state(id));
      assertCancelledAt(id, after.equals("CANCELLED") ? NOW : null);
    }
  }

  @Test
  void reminderCooldownAndTerminalStatesRejectSubsequentActions() throws Exception {
    UUID id = order(cafeteria(), "CALLED", 0);
    sql("UPDATE public.orders SET reminder_count=0 WHERE id='" + id + "'");
    mutate(id, "remind");
    assertThrows(DomainException.class, () -> mutate(id, "remind"));
    mutate(id, "deliver");
    assertThrows(DomainException.class, () -> mutate(id, "not-collected"));
    assertEquals("DELIVERED", state(id));
  }

  @Test
  void detachedStaleDomainCopyCannotOverwriteACommittedHibernateVersion() throws Exception {
    UUID id = order(cafeteria(), "PENDING", 0);
    Order stale = tx.execute(s -> orders.findById(id).orElseThrow());
    mutate(id, "prepare");
    stale.cancelByClient(NOW);
    assertThrows(
        jakarta.persistence.OptimisticLockException.class,
        () -> tx.execute(s -> orders.save(stale)));
    assertEquals("PREPARING", state(id));
    assertCancelledAt(id, null);
  }

  @Test
  void privilegedSqlWritesAlsoInvalidateDetachedVersions() throws Exception {
    UUID id = order(cafeteria(), "PENDING", 0);
    Order stale = tx.execute(s -> orders.findById(id).orElseThrow());
    sql("UPDATE public.orders SET status='PREPARING' WHERE id='" + id + "'");
    stale.cancelByClient(NOW);
    assertThrows(
        jakarta.persistence.OptimisticLockException.class,
        () -> tx.execute(s -> orders.save(stale)));
    assertEquals("PREPARING", state(id));
    assertCancelledAt(id, null);
  }

  @Test
  void staleCopiesAndLaterUpdatesCannotReplaceTheWinningCancellationInstant() throws Exception {
    UUID id = order(cafeteria(), "PENDING", 0);
    Order stale = tx.execute(s -> orders.findById(id).orElseThrow());
    Order cancelled = mutate(id, "worker-cancel");
    assertEquals(NOW, cancelled.getCancelledAt());
    assertCancelledAt(id, NOW);
    stale.cancelByClient(NOW.plusSeconds(60));
    assertThrows(
        jakarta.persistence.OptimisticLockException.class,
        () -> tx.execute(s -> orders.save(stale)));
    assertThrows(DomainException.class, () -> mutate(id, "cancel"));
    sql("UPDATE public.orders SET total=2 WHERE id='" + id + "'");
    assertEquals("CANCELLED", state(id));
    assertCancelledAt(id, NOW);
  }

  @Test
  void fifoRejectsSkippingAndAdvancesAfterCancellation() throws Exception {
    UUID cafe = cafeteria(), first = order(cafe, "PENDING", 0), second = order(cafe, "PENDING", 1);
    assertThrows(OrderProcessingSequenceException.class, () -> mutate(second, "prepare"));
    assertEquals("PENDING", state(second));
    mutate(first, "cancel");
    mutate(second, "prepare");
    assertEquals("CANCELLED", state(first));
    assertEquals("PREPARING", state(second));
    assertCancelledAt(first, NOW);
    assertCancelledAt(second, null);
  }
}

package com.santotofood.application.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

import com.santotofood.application.exception.ClientOrderException;
import com.santotofood.application.model.ClientOrder;
import com.santotofood.application.port.in.CreateOwnOrderUseCase.Line;
import com.santotofood.application.port.in.CreateOwnOrderUseCase.OrderRequest;
import com.santotofood.application.port.out.ClientOrderCommandPort;
import com.santotofood.application.port.out.ClientOrderCommandPort.KeyedOrder;
import com.santotofood.application.port.out.ClientOrderCommandPort.LockedCafeteria;
import com.santotofood.application.port.out.ClientOrderCommandPort.LockedProduct;
import com.santotofood.application.port.out.ClientOrderCommandPort.NewItem;
import com.santotofood.application.port.out.ClientOrderCommandPort.NewOrder;
import com.santotofood.application.port.out.ClientOrderCommandPort.OrderingClient;
import com.santotofood.domain.port.out.TimeProvider;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.dao.QueryTimeoutException;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.TransactionStatus;
import org.springframework.transaction.support.SimpleTransactionStatus;

/** Order rules on stubbed facts; JDBC, locks and races are covered by the Postgres API test. */
class ClientOrderCreationServiceTest {
  static final UUID USER = UUID.randomUUID();
  static final UUID INSTITUTION = UUID.randomUUID();
  static final UUID CAFETERIA = UUID.randomUUID();
  static final UUID JUICE = UUID.fromString("00000000-0000-0000-0000-000000000001");
  static final UUID LUNCH = UUID.fromString("00000000-0000-0000-0000-000000000002");
  static final String KEY = "key-0123456789abcdef";
  // 2026-11-20 12:00 in America/Bogota.
  static final Instant NOW = Instant.parse("2026-11-20T17:00:00Z");
  static final LocalDate TODAY = LocalDate.parse("2026-11-20");
  static final OrderingClient CLIENT =
      new OrderingClient(UUID.randomUUID(), "Ana Torres", INSTITUTION, "STUDENT", "1234567");

  ClientOrderCommandPort port;
  PlatformTransactionManager manager;
  ClientOrderCreationService service;

  @BeforeEach
  void setUp() {
    port = mock(ClientOrderCommandPort.class);
    manager = mock(PlatformTransactionManager.class);
    when(manager.getTransaction(any())).thenAnswer(call -> new SimpleTransactionStatus());
    TimeProvider clock = () -> NOW;
    service = new ClientOrderCreationService(port, clock, manager);
    when(port.findOrderingClient(USER)).thenReturn(Optional.of(CLIENT));
    when(port.findByIdempotencyKey(any(), any())).thenReturn(Optional.empty());
    when(port.findActiveOrder(any())).thenReturn(Optional.empty());
    when(port.lockCafeteria(INSTITUTION, CAFETERIA))
        .thenReturn(Optional.of(new LockedCafeteria(CAFETERIA, true)));
    when(port.lockOpenToday(CAFETERIA, TODAY)).thenReturn(true);
    when(port.lockProducts(eq(CAFETERIA), anyList()))
        .thenReturn(
            List.of(
                new LockedProduct(JUICE, "Jugo natural", new BigDecimal("4500.00"), true),
                new LockedProduct(LUNCH, "Corriente", new BigDecimal("13000.00"), true)));
    when(port.lockAvailableToday(eq(CAFETERIA), anyList(), eq(TODAY)))
        .thenReturn(Set.of(JUICE, LUNCH));
    when(port.findOrder(any()))
        .thenAnswer(
            call ->
                Optional.of(
                    new ClientOrder(
                        call.getArgument(0),
                        "PENDING",
                        BigDecimal.TEN,
                        null,
                        NOW,
                        List.of(),
                        new ClientOrder.Cafeteria(CAFETERIA, "Cafetería Central"),
                        null,
                        null,
                        new ClientOrder.Timeline(NOW, null, 0, null, null, null, null),
                        null)));
  }

  static OrderRequest request(String note, Line... lines) {
    return new OrderRequest(CAFETERIA, List.of(lines), note);
  }

  String code(Runnable call) {
    return assertThrows(ClientOrderException.class, call::run).getCode();
  }

  String hashOf(OrderRequest request) {
    service.createOwnOrder(USER, KEY, request);
    var order = ArgumentCaptor.forClass(NewOrder.class);
    verify(port, atLeastOnce()).insertOrder(order.capture());
    return order.getValue().requestHash();
  }

  @Test
  void computesTheTotalFromDatabasePricesInOneTransaction() {
    var created =
        service.createOwnOrder(USER, KEY, request(null, new Line(JUICE, 2), new Line(LUNCH, 1)));

    assertTrue(created.created());
    var order = ArgumentCaptor.forClass(NewOrder.class);
    verify(port).insertOrder(order.capture());
    assertEquals(0, new BigDecimal("22000").compareTo(order.getValue().total()));
    assertEquals(CLIENT, order.getValue().client());
    assertEquals(KEY, order.getValue().idempotencyKey());
    assertTrue(order.getValue().requestHash().matches("[0-9a-f]{64}"));
    @SuppressWarnings("unchecked")
    ArgumentCaptor<List<NewItem>> items = ArgumentCaptor.forClass(List.class);
    verify(port).insertItems(eq(order.getValue().id()), eq(CAFETERIA), items.capture());
    assertEquals(
        List.of(4500 * 2, 13000),
        items.getValue().stream().map(i -> i.subtotal().intValue()).toList());
    verify(manager)
        .getTransaction(
            argThat(
                definition ->
                    !definition.isReadOnly()
                        && definition.getIsolationLevel()
                            == TransactionDefinition.ISOLATION_READ_COMMITTED
                        && definition.getTimeout() == 15));
    verify(manager).commit(any());
  }

  @Test
  void locksInTheOrderOfTheDecisions() {
    service.createOwnOrder(USER, KEY, request(null, new Line(LUNCH, 1), new Line(JUICE, 1)));
    InOrder order = inOrder(port);
    order.verify(port).lockCafeteria(INSTITUTION, CAFETERIA);
    order.verify(port).lockProducts(CAFETERIA, List.of(JUICE, LUNCH));
    order.verify(port).lockOpenToday(CAFETERIA, TODAY);
    order.verify(port).lockAvailableToday(CAFETERIA, List.of(JUICE, LUNCH), TODAY);
    order.verify(port).insertOrder(any());
  }

  @Test
  void aMissingOrInactiveClientIsForbiddenBeforeAnyValidation() {
    when(port.findOrderingClient(USER)).thenReturn(Optional.empty());
    assertEquals("FORBIDDEN", code(() -> service.createOwnOrder(USER, "bad", null)));
    verify(port, never()).findByIdempotencyKey(any(), any());
  }

  @Test
  void limitsAreTenPerProductAndFifteenInTotal() {
    assertTrue(
        service
            .createOwnOrder(USER, KEY, request(null, new Line(JUICE, 10), new Line(LUNCH, 5)))
            .created());
    assertEquals(
        "ORDER_LIMIT_EXCEEDED",
        code(() -> service.createOwnOrder(USER, KEY, request(null, new Line(JUICE, 11)))));
    assertEquals(
        "ORDER_LIMIT_EXCEEDED",
        code(
            () ->
                service.createOwnOrder(
                    USER, KEY, request(null, new Line(JUICE, 10), new Line(LUNCH, 6)))));
  }

  @Test
  void shapeErrorsAreInvalidRequests() {
    for (var bad :
        new OrderRequest[] {
          null,
          new OrderRequest(null, List.of(new Line(JUICE, 1)), null),
          new OrderRequest(CAFETERIA, List.of(), null),
          request(null, new Line(JUICE, 0)),
          request(null, new Line(null, 1)),
          request(null, new Line(JUICE, 1), new Line(JUICE, 1))
        })
      assertEquals("INVALID_ORDER_REQUEST", code(() -> service.createOwnOrder(USER, KEY, bad)));
    for (var key : new String[] {null, "", "short", "with space 0123456789", "k".repeat(129)})
      assertEquals(
          "INVALID_ORDER_REQUEST",
          code(() -> service.createOwnOrder(USER, key, request(null, new Line(JUICE, 1)))));
    verify(port, never()).insertOrder(any());
  }

  @Test
  void theNoteIsTrimmedCountedInCharactersAndBlankMeansNone() {
    assertEquals(
        "ORDER_NOTE_TOO_LONG",
        code(
            () -> service.createOwnOrder(USER, KEY, request("a".repeat(201), new Line(JUICE, 1)))));
    // 200 emoji are 400 UTF-16 units but 200 characters for PostgreSQL.
    assertTrue(
        service.createOwnOrder(USER, KEY, request("😀".repeat(200), new Line(JUICE, 1))).created());
    var none = hashOf(request(null, new Line(JUICE, 1)));
    assertEquals(none, hashOf(request("", new Line(JUICE, 1))));
    assertEquals(none, hashOf(request("   ", new Line(JUICE, 1))));
    var order = ArgumentCaptor.forClass(NewOrder.class);
    verify(port, atLeastOnce()).insertOrder(order.capture());
    assertNull(order.getValue().note());
    assertEquals(
        hashOf(request("Sin hielo", new Line(JUICE, 1))),
        hashOf(request("  Sin hielo ", new Line(JUICE, 1))));
  }

  @Test
  void theHashIgnoresItemOrderButNotContent() {
    var base = hashOf(request("x", new Line(JUICE, 1), new Line(LUNCH, 2)));
    assertEquals(base, hashOf(request("x", new Line(LUNCH, 2), new Line(JUICE, 1))));
    assertNotEquals(base, hashOf(request("y", new Line(JUICE, 1), new Line(LUNCH, 2))));
    assertNotEquals(base, hashOf(request("x", new Line(JUICE, 2), new Line(LUNCH, 2))));
    assertNotEquals(base, hashOf(request(null, new Line(JUICE, 1), new Line(LUNCH, 2))));
  }

  @Test
  void aKnownKeyReplaysWithTheSameBodyAndConflictsWithAnother() {
    var hash = hashOf(request(null, new Line(JUICE, 1)));
    UUID existing = UUID.randomUUID();
    when(port.findByIdempotencyKey(CLIENT.clientId(), KEY))
        .thenReturn(Optional.of(new KeyedOrder(existing, hash)));
    // Replays win over every other rule, even a closed cafeteria.
    when(port.lockOpenToday(CAFETERIA, TODAY)).thenReturn(false);
    clearInvocations(port);

    var replay = service.createOwnOrder(USER, KEY, request(null, new Line(JUICE, 1)));
    assertFalse(replay.created());
    assertEquals(existing, replay.order().id());
    assertEquals(
        "IDEMPOTENCY_KEY_CONFLICT",
        code(() -> service.createOwnOrder(USER, KEY, request("otra", new Line(JUICE, 1)))));
    verify(port, never()).lockCafeteria(any(), any());
    verify(port, never()).insertOrder(any());
  }

  @Test
  void anActiveOrderIsReportedWithItsId() {
    UUID active = UUID.randomUUID();
    when(port.findActiveOrder(CLIENT.clientId())).thenReturn(Optional.of(active));
    var error =
        assertThrows(
            ClientOrderException.class,
            () -> service.createOwnOrder(USER, KEY, request(null, new Line(JUICE, 1))));
    assertEquals("ACTIVE_ORDER_EXISTS", error.getCode());
    assertEquals(active, error.getActiveOrderId());
  }

  @Test
  void cafeteriaAndProductRulesUseFixedCodes() {
    when(port.lockCafeteria(INSTITUTION, CAFETERIA)).thenReturn(Optional.empty());
    assertEquals(
        "CAFETERIA_NOT_FOUND",
        code(() -> service.createOwnOrder(USER, KEY, request(null, new Line(JUICE, 1)))));
    when(port.lockCafeteria(INSTITUTION, CAFETERIA))
        .thenReturn(Optional.of(new LockedCafeteria(CAFETERIA, false)));
    assertEquals(
        "CAFETERIA_NOT_SUBSCRIBED",
        code(() -> service.createOwnOrder(USER, KEY, request(null, new Line(JUICE, 1)))));
    when(port.lockCafeteria(INSTITUTION, CAFETERIA))
        .thenReturn(Optional.of(new LockedCafeteria(CAFETERIA, true)));
    when(port.lockOpenToday(CAFETERIA, TODAY)).thenReturn(false);
    assertEquals(
        "CAFETERIA_CLOSED",
        code(() -> service.createOwnOrder(USER, KEY, request(null, new Line(JUICE, 1)))));
    when(port.lockOpenToday(CAFETERIA, TODAY)).thenReturn(true);
    when(port.lockAvailableToday(eq(CAFETERIA), anyList(), eq(TODAY))).thenReturn(Set.of(LUNCH));
    assertEquals(
        "PRODUCT_UNAVAILABLE",
        code(() -> service.createOwnOrder(USER, KEY, request(null, new Line(JUICE, 1)))));
    when(port.lockAvailableToday(eq(CAFETERIA), anyList(), eq(TODAY)))
        .thenReturn(Set.of(JUICE, LUNCH));
    when(port.lockProducts(eq(CAFETERIA), anyList()))
        .thenReturn(
            List.of(new LockedProduct(JUICE, "Jugo natural", new BigDecimal("4500.00"), false)));
    assertEquals(
        "PRODUCT_UNAVAILABLE",
        code(() -> service.createOwnOrder(USER, KEY, request(null, new Line(JUICE, 1)))));
    assertEquals(
        "PRODUCT_UNAVAILABLE",
        code(
            () ->
                service.createOwnOrder(USER, KEY, request(null, new Line(UUID.randomUUID(), 1)))));
    verify(port, never()).insertOrder(any());
  }

  @Test
  void losingTheKeyRaceRollsBackAndReplaysTheWinner() {
    var hash = hashOf(request(null, new Line(JUICE, 1)));
    UUID winner = UUID.randomUUID();
    doThrow(new DuplicateKeyException("uq_orders_client_idempotency_key"))
        .when(port)
        .insertOrder(any());
    when(port.findByIdempotencyKey(CLIENT.clientId(), KEY))
        .thenReturn(Optional.empty())
        .thenReturn(Optional.of(new KeyedOrder(winner, hash)));
    clearInvocations(manager);

    var replay = service.createOwnOrder(USER, KEY, request(null, new Line(JUICE, 1)));
    assertFalse(replay.created());
    assertEquals(winner, replay.order().id());
    verify(manager).rollback(any(TransactionStatus.class));
    verify(manager).getTransaction(argThat(TransactionDefinition::isReadOnly));
  }

  @Test
  void losingTheActiveOrderRaceIsAConflictWithTheWinnersId() {
    UUID winner = UUID.randomUUID();
    doThrow(new DuplicateKeyException("uq_orders_one_active_per_client"))
        .when(port)
        .insertOrder(any());
    when(port.findActiveOrder(CLIENT.clientId()))
        .thenReturn(Optional.empty())
        .thenReturn(Optional.of(winner));
    var error =
        assertThrows(
            ClientOrderException.class,
            () -> service.createOwnOrder(USER, KEY, request(null, new Line(JUICE, 1))));
    assertEquals("ACTIVE_ORDER_EXISTS", error.getCode());
    assertEquals(winner, error.getActiveOrderId());
  }

  @Test
  void anUnexplainedRaceOrATransientFailureIsTemporary() {
    doThrow(new DuplicateKeyException("race")).when(port).insertOrder(any());
    assertEquals(
        "ORDER_TEMPORARILY_UNAVAILABLE",
        code(() -> service.createOwnOrder(USER, KEY, request(null, new Line(JUICE, 1)))));
    reset(port);
    when(port.findOrderingClient(USER)).thenThrow(new QueryTimeoutException("slow"));
    assertEquals(
        "ORDER_TEMPORARILY_UNAVAILABLE",
        code(() -> service.createOwnOrder(USER, KEY, request(null, new Line(JUICE, 1)))));
  }

  // ------------------------------------------------------------------ requested pickup time

  static OrderRequest pickupAt(String requestedPickupAt) {
    return new OrderRequest(CAFETERIA, List.of(new Line(JUICE, 1)), null, requestedPickupAt);
  }

  NewOrder inserted() {
    var order = ArgumentCaptor.forClass(NewOrder.class);
    verify(port, atLeastOnce()).insertOrder(order.capture());
    return order.getValue();
  }

  @Test
  void withoutAPickupTimeTheOrderIsAsSoonAsPossible() {
    assertTrue(service.createOwnOrder(USER, KEY, pickupAt(null)).created());
    assertNull(inserted().requestedPickupAt());
  }

  @Test
  void aValidPickupTimeIsStoredAsTheInstantItNames() {
    assertTrue(service.createOwnOrder(USER, KEY, pickupAt("2026-11-20T13:30:00-05:00")).created());
    assertEquals(Instant.parse("2026-11-20T18:30:00Z"), inserted().requestedPickupAt());
  }

  @Test
  void aPastOrNowPickupTimeIsRefusedBeforeAnyLock() {
    for (var past :
        new String[] {
          "2026-11-20T12:00:00-05:00", "2026-11-20T11:59:00-05:00", "2026-11-19T13:00Z"
        })
      assertEquals(
          "INVALID_PICKUP_TIME", code(() -> service.createOwnOrder(USER, KEY, pickupAt(past))));
    verify(port, never()).lockCafeteria(any(), any());
    verify(port, never()).insertOrder(any());
  }

  @Test
  void aPickupTimeOnAnotherBusinessDayIsRefused() {
    for (var other :
        new String[] {
          // Midnight in Bogotá already belongs to tomorrow.
          "2026-11-21T00:00:00-05:00", "2026-11-21T12:00:00-05:00", "2026-12-20T13:00:00-05:00"
        })
      assertEquals(
          "INVALID_PICKUP_TIME", code(() -> service.createOwnOrder(USER, KEY, pickupAt(other))));
    verify(port, never()).insertOrder(any());
  }

  @Test
  void aMalformedOrOffsetlessPickupTimeIsRefused() {
    for (var bad : new String[] {"", "13:30", "2026-11-20T13:30:00", "2026-11-20", "pronto"})
      assertEquals(
          "INVALID_PICKUP_TIME", code(() -> service.createOwnOrder(USER, KEY, pickupAt(bad))));
    verify(port, never()).insertOrder(any());
  }

  @Test
  void theHashWithoutAPickupTimeIsTheOneOfB15() throws Exception {
    // Keys stored before 023 must keep replaying: the canonical form without a time is unchanged.
    var canonical = "order-v1\n" + CAFETERIA + "\n" + JUICE + ":1\n-";
    var expected =
        java.util.HexFormat.of()
            .formatHex(
                java.security.MessageDigest.getInstance("SHA-256")
                    .digest(canonical.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
    assertEquals(expected, hashOf(pickupAt(null)));
  }

  @Test
  void theHashIncludesThePickupInstantButNotItsOffset() {
    var none = hashOf(pickupAt(null));
    var oneThirty = hashOf(pickupAt("2026-11-20T13:30:00-05:00"));
    assertNotEquals(none, oneThirty);
    assertEquals(oneThirty, hashOf(pickupAt("2026-11-20T18:30:00Z")));
    assertNotEquals(oneThirty, hashOf(pickupAt("2026-11-20T13:45:00-05:00")));
  }

  @Test
  void theSameKeyWithAnotherPickupTimeConflicts() {
    var hash = hashOf(pickupAt("2026-11-20T13:30:00-05:00"));
    UUID existing = UUID.randomUUID();
    when(port.findByIdempotencyKey(CLIENT.clientId(), KEY))
        .thenReturn(Optional.of(new KeyedOrder(existing, hash)));
    clearInvocations(port);

    assertEquals(
        existing, service.createOwnOrder(USER, KEY, pickupAt("2026-11-20T18:30Z")).order().id());
    for (var other : new String[] {"2026-11-20T14:00:00-05:00", null})
      assertEquals(
          "IDEMPOTENCY_KEY_CONFLICT",
          code(() -> service.createOwnOrder(USER, KEY, pickupAt(other))));
    verify(port, never()).insertOrder(any());
  }

  @Test
  void aReplayAnswersEvenAfterItsPickupTimePassed() {
    // Served at 12:00 for 12:30; the retry arrives at 13:00 and is still the same request.
    var hash = hashOf(pickupAt("2026-11-20T12:30:00-05:00"));
    UUID existing = UUID.randomUUID();
    when(port.findByIdempotencyKey(CLIENT.clientId(), KEY))
        .thenReturn(Optional.of(new KeyedOrder(existing, hash)));
    var later =
        new ClientOrderCreationService(port, () -> Instant.parse("2026-11-20T18:00:00Z"), manager);

    var replay = later.createOwnOrder(USER, KEY, pickupAt("2026-11-20T12:30:00-05:00"));
    assertFalse(replay.created());
    assertEquals(existing, replay.order().id());
  }

  @Test
  void itemsFollowTheRequestedQuantities() {
    var lines = new ArrayList<Line>(List.of(new Line(LUNCH, 3), new Line(JUICE, 4)));
    service.createOwnOrder(USER, KEY, new OrderRequest(CAFETERIA, lines, null));
    @SuppressWarnings("unchecked")
    ArgumentCaptor<List<NewItem>> items = ArgumentCaptor.forClass(List.class);
    verify(port).insertItems(any(), eq(CAFETERIA), items.capture());
    assertEquals(
        Set.of(4, 3), Set.copyOf(items.getValue().stream().map(NewItem::quantity).toList()));
  }
}

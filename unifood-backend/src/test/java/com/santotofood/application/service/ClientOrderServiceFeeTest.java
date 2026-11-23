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
import com.santotofood.application.port.out.ClientOrderCommandPort.NewOrder;
import com.santotofood.application.port.out.ClientOrderCommandPort.OrderingClient;
import com.santotofood.application.port.out.ServiceFeeQueryPort;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.SimpleTransactionStatus;

/**
 * Service fee on order creation (docs/modelo-de-negocio.md, rules 3 to 5): the server adds it,
 * freezes it, refuses a stale one with 409 and keeps the idempotency hash.
 */
class ClientOrderServiceFeeTest {
  static final UUID USER = UUID.randomUUID();
  static final UUID INSTITUTION = UUID.randomUUID();
  static final UUID CAFETERIA = UUID.randomUUID();
  static final UUID JUICE = UUID.fromString("00000000-0000-0000-0000-000000000001");
  static final String KEY = "key-0123456789abcdef";
  static final Instant NOW = Instant.parse("2026-11-20T17:00:00Z");
  static final LocalDate TODAY = LocalDate.parse("2026-11-20");
  static final OrderingClient CLIENT =
      new OrderingClient(UUID.randomUUID(), "Ana Torres", INSTITUTION, "STUDENT", "1234567");

  ClientOrderCommandPort port;
  ServiceFeeQueryPort fees;
  PlatformTransactionManager manager;
  boolean enabled = true;
  ClientOrderCreationService service;

  @BeforeEach
  void setUp() {
    port = mock(ClientOrderCommandPort.class);
    fees = mock(ServiceFeeQueryPort.class);
    manager = mock(PlatformTransactionManager.class);
    when(manager.getTransaction(any())).thenAnswer(call -> new SimpleTransactionStatus());
    service =
        new ClientOrderCreationService(
            port, () -> NOW, manager, event -> {}, () -> false, null, () -> enabled, fees);
    when(port.findOrderingClient(USER)).thenReturn(Optional.of(CLIENT));
    when(port.findByIdempotencyKey(any(), any())).thenReturn(Optional.empty());
    when(port.findActiveOrder(any())).thenReturn(Optional.empty());
    when(port.lockCafeteria(INSTITUTION, CAFETERIA))
        .thenReturn(Optional.of(new LockedCafeteria(CAFETERIA, true)));
    when(port.lockOpenToday(CAFETERIA, TODAY)).thenReturn(true);
    when(port.lockProducts(eq(CAFETERIA), anyList()))
        .thenReturn(
            List.of(new LockedProduct(JUICE, "Jugo natural", new BigDecimal("4500.00"), true)));
    when(port.lockAvailableToday(eq(CAFETERIA), anyList(), eq(TODAY))).thenReturn(Set.of(JUICE));
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

  static OrderRequest request(Integer expectedFee) {
    return new OrderRequest(CAFETERIA, List.of(new Line(JUICE, 2)), null, null, null, expectedFee);
  }

  NewOrder inserted() {
    var order = ArgumentCaptor.forClass(NewOrder.class);
    verify(port).insertOrder(order.capture());
    return order.getValue();
  }

  ClientOrderException refused(OrderRequest request) {
    return assertThrows(
        ClientOrderException.class, () -> service.createOwnOrder(USER, KEY, request));
  }

  @Test
  void addsTheFeeInForceToTheProductsAndFreezesIt() {
    when(fees.lockEffectiveFee(CAFETERIA)).thenReturn(300);
    service.createOwnOrder(USER, KEY, request(300));
    var order = inserted();
    assertEquals(0, new BigDecimal("9300").compareTo(order.total()));
    assertEquals(300, order.serviceFeeCop());
    // Read with the lock, inside the order's transaction; never the plain read.
    verify(fees).lockEffectiveFee(CAFETERIA);
    verify(fees, never()).effectiveFee(any());
  }

  @Test
  void aFeeOfZeroAddsNothingWithOrWithoutTheExpectedValue() {
    when(fees.lockEffectiveFee(CAFETERIA)).thenReturn(0);
    service.createOwnOrder(USER, KEY, request(0));
    assertEquals(0, new BigDecimal("9000").compareTo(inserted().total()));
    assertEquals(0, inserted().serviceFeeCop());

    reset(port);
    setUp();
    when(fees.lockEffectiveFee(CAFETERIA)).thenReturn(0);
    service.createOwnOrder(USER, KEY, request(null));
    assertEquals(0, inserted().serviceFeeCop());
  }

  @Test
  void aChangedFeeIsA409WithTheCurrentValueAndWritesNothing() {
    when(fees.lockEffectiveFee(CAFETERIA)).thenReturn(400);
    var error = refused(request(300));
    assertEquals("SERVICE_FEE_CHANGED", error.getCode());
    assertEquals(ClientOrderException.Kind.CONFLICT, error.getKind());
    assertEquals(400, error.getServiceFee());
    assertEquals(
        "El cargo por servicio cambió. Revisa el total y confirma de nuevo.", error.getMessage());
    verify(port, never()).insertOrder(any());
    verify(port, never()).insertItems(any(), any(), any());
  }

  @Test
  void withoutTheExpectedValueOnlyAFeeOfZeroIsAccepted() {
    when(fees.lockEffectiveFee(CAFETERIA)).thenReturn(300);
    var error = refused(request(null));
    assertEquals("SERVICE_FEE_CHANGED", error.getCode());
    assertEquals(300, error.getServiceFee());
    verify(port, never()).insertOrder(any());
  }

  @Test
  void withTheFlagOffTheFeeIsZeroAndNeverRead() {
    enabled = false;
    service.createOwnOrder(USER, KEY, request(null));
    assertEquals(0, inserted().serviceFeeCop());
    assertEquals(0, new BigDecimal("9000").compareTo(inserted().total()));
    verifyNoInteractions(fees);
  }

  @Test
  void withTheFlagOffAStaleExpectedFeeIsA409WithZero() {
    enabled = false;
    var error = refused(request(300));
    assertEquals("SERVICE_FEE_CHANGED", error.getCode());
    assertEquals(0, error.getServiceFee());
  }

  @Test
  void anExpectedFeeOutOfRangeIsABadRequest() {
    for (int fee : new int[] {-1, 2001}) {
      var error = refused(request(fee));
      assertEquals("INVALID_ORDER_REQUEST", error.getCode());
    }
    verifyNoInteractions(fees);
  }

  @Test
  void theExpectedFeeIsNotPartOfTheRequestHash() {
    when(fees.lockEffectiveFee(CAFETERIA)).thenReturn(0);
    service.createOwnOrder(USER, KEY, request(null));
    String without = inserted().requestHash();
    reset(port);
    setUp();
    when(fees.lockEffectiveFee(CAFETERIA)).thenReturn(0);
    service.createOwnOrder(USER, KEY, request(0));
    assertEquals(without, inserted().requestHash());
    // And it is the same hash the order had before 033 (no expectedServiceFee at all).
    reset(port);
    setUp();
    enabled = false;
    service.createOwnOrder(
        USER, KEY, new OrderRequest(CAFETERIA, List.of(new Line(JUICE, 2)), null));
    assertEquals(without, inserted().requestHash());
  }

  @Test
  void aRetryWithTheSameKeyReturnsTheSameOrderEvenIfTheFeeChangedMeanwhile() {
    when(fees.lockEffectiveFee(CAFETERIA)).thenReturn(300);
    service.createOwnOrder(USER, KEY, request(300));
    var first = inserted();
    // The fee rises to 400 and the client retries the very same request (with or without it).
    when(fees.lockEffectiveFee(CAFETERIA)).thenReturn(400);
    when(port.findByIdempotencyKey(CLIENT.clientId(), KEY))
        .thenReturn(Optional.of(new KeyedOrder(first.id(), first.requestHash())));
    for (Integer expected : new Integer[] {300, null}) {
      var replay = service.createOwnOrder(USER, KEY, request(expected));
      assertFalse(replay.created());
      assertEquals(first.id(), replay.order().id());
    }
    verify(port, times(1)).insertOrder(any());
    verify(fees, times(1)).lockEffectiveFee(CAFETERIA);
  }

  @Test
  void aStoredOrderSplitsItsTotalIntoProductsAndFee() {
    var order =
        new ClientOrder(
            UUID.randomUUID(),
            "DELIVERED",
            new BigDecimal("9300.00"),
            null,
            NOW,
            List.of(),
            new ClientOrder.Cafeteria(CAFETERIA, "Cafetería Central"),
            null,
            null,
            new ClientOrder.Timeline(NOW, null, 0, null, null, null, null),
            null,
            null,
            300);
    assertEquals(0, new BigDecimal("9000").compareTo(order.productsSubtotal()));
    // withDailyMenu keeps the frozen fee.
    assertEquals(300, order.withDailyMenu(null).serviceFeeCop());
  }
}

package com.santotofood.application.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.santotofood.application.exception.OrderNotFoundException;
import com.santotofood.domain.exception.CancellationDeadlineExpiredException;
import com.santotofood.domain.exception.InvalidOrderStateException;
import com.santotofood.domain.model.Order;
import com.santotofood.domain.model.OrderStatus;
import com.santotofood.domain.port.out.*;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.junit.jupiter.params.provider.ValueSource;

class ClientOrderCancellationServiceTest {
  final OrderRepository orders = mock(OrderRepository.class);
  final OrderItemRepository items = mock(OrderItemRepository.class);
  final TimeProvider clock = mock(TimeProvider.class);
  final OrderService service = new OrderService(orders, items, clock);
  final UUID id = UUID.randomUUID();
  final Instant created = Instant.parse("2026-01-01T00:00:00Z");
  final Instant now = created.plusSeconds(3600);

  Order order(OrderStatus status) {
    Order order =
        Order.reconstitute(
            id,
            UUID.randomUUID(),
            UUID.randomUUID(),
            "Fixture client",
            "12345",
            status,
            BigDecimal.ONE,
            created.plusSeconds(1),
            created,
            created);
    when(orders.findByIdForUpdate(id)).thenReturn(Optional.of(order));
    when(clock.now()).thenReturn(now);
    return order;
  }

  @Test
  void pendingClientOrderIsSavedEvenAfterTheLegacyDeadline() {
    Order order = order(OrderStatus.PENDING);
    when(orders.save(order)).thenReturn(order);
    when(items.findByOrderId(id)).thenReturn(List.of());
    assertSame(order, service.cancelOwnOrder(id));
    assertEquals(OrderStatus.CANCELLED, order.getStatus());
    assertTrue(order.isCancelledByClient());
    assertEquals(now, order.getCancelledAt());
    assertEquals(now, order.getUpdatedAt());
    var sequence = inOrder(orders, clock);
    sequence.verify(orders).findByIdForUpdate(id);
    sequence.verify(clock).now();
    sequence.verify(orders).save(order);
    verifyNoMoreInteractions(orders);
  }

  @Test
  void workerCancellationRecordsTheClockTimeAtItsExistingDeadline() {
    Order order = order(OrderStatus.PENDING);
    Instant atDeadline = order.getCancellationDeadline();
    when(clock.now()).thenReturn(atDeadline);
    when(orders.save(order)).thenReturn(order);
    when(items.findByOrderId(id)).thenReturn(List.of());

    assertSame(order, service.cancelOrder(id));
    assertEquals(OrderStatus.CANCELLED, order.getStatus());
    assertFalse(order.isCancelledByClient());
    assertEquals(atDeadline, order.getCancelledAt());
    assertEquals(atDeadline, order.getUpdatedAt());
    var sequence = inOrder(orders, clock);
    sequence.verify(orders).findByIdForUpdate(id);
    sequence.verify(clock).now();
    sequence.verify(orders).save(order);
    verifyNoMoreInteractions(orders);
  }

  @Test
  void repeatedClientCancellationCannotReplaceTheKnownTimeOrSaveAgain() {
    Order order = order(OrderStatus.PENDING);
    when(orders.save(order)).thenReturn(order);
    when(items.findByOrderId(id)).thenReturn(List.of());
    service.cancelOwnOrder(id);
    when(clock.now()).thenReturn(now.plusSeconds(60));

    assertThrows(InvalidOrderStateException.class, () -> service.cancelOwnOrder(id));
    assertEquals(now, order.getCancelledAt());
    assertEquals(now, order.getUpdatedAt());
    verify(orders).save(order);
    verify(items).findByOrderId(id);
  }

  @ParameterizedTest
  @EnumSource(value = OrderStatus.class, names = "PENDING", mode = EnumSource.Mode.EXCLUDE)
  void allOtherStatesAreRejectedByTheDomainAndNeverSaved(OrderStatus status) {
    Order order = order(status);
    assertThrows(InvalidOrderStateException.class, () -> order.cancelByClient(now));
    assertThrows(InvalidOrderStateException.class, () -> service.cancelOwnOrder(id));
    assertEquals(status, order.getStatus());
    assertNull(order.getCancelledAt());
    assertEquals(created, order.getUpdatedAt());
    verify(orders, never()).save(any());
    verifyNoInteractions(items);
  }

  @Test
  void missingOrderIsNotFoundAndNeverSaved() {
    assertThrows(OrderNotFoundException.class, () -> service.cancelOwnOrder(id));
    verify(orders, never()).save(any());
    verifyNoInteractions(clock, items);
  }

  @Test
  void workerCancellationStillEnforcesItsExistingDeadline() {
    Order order = order(OrderStatus.PENDING);
    assertThrows(CancellationDeadlineExpiredException.class, () -> service.cancelOrder(id));
    assertEquals(OrderStatus.PENDING, order.getStatus());
    assertNull(order.getCancelledAt());
    assertEquals(created, order.getUpdatedAt());
    verify(orders, never()).save(any());
    verifyNoInteractions(items);
  }

  @ParameterizedTest
  @ValueSource(booleans = {false, true})
  void missingOperationTimeCannotCancelOrSaveForEitherActor(boolean client) {
    Order order = order(OrderStatus.PENDING);
    when(clock.now()).thenReturn(null);

    assertThrows(
        IllegalArgumentException.class,
        () -> {
          if (client) service.cancelOwnOrder(id);
          else service.cancelOrder(id);
        });
    assertEquals(OrderStatus.PENDING, order.getStatus());
    assertNull(order.getCancelledAt());
    assertEquals(created, order.getUpdatedAt());
    verify(orders, never()).save(any());
    verifyNoInteractions(items);
  }
}

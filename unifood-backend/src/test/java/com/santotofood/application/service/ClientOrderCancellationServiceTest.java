package com.santotofood.application.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.santotofood.application.exception.OrderNotFoundException;
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
            "1234567",
            "STUDENT",
            status,
            BigDecimal.ONE,
            created,
            created);
    when(orders.findByIdForUpdate(id)).thenReturn(Optional.of(order));
    when(clock.now()).thenReturn(now);
    return order;
  }

  @Test
  void pendingClientOrderIsCancelledWithoutAnyDeadline() {
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
  void repeatedClientCancellationReturnsTheOrderWithoutReplacingTheTimeOrSavingAgain() {
    Order order = order(OrderStatus.PENDING);
    when(orders.save(order)).thenReturn(order);
    when(items.findByOrderId(id)).thenReturn(List.of());
    service.cancelOwnOrder(id);
    when(clock.now()).thenReturn(now.plusSeconds(60));

    assertSame(order, service.cancelOwnOrder(id));
    assertEquals(OrderStatus.CANCELLED, order.getStatus());
    assertEquals(now, order.getCancelledAt());
    assertEquals(now, order.getUpdatedAt());
    verify(orders, times(1)).save(order);
  }

  @Test
  void anOrderCancelledByTheCafeteriaIsStillAConflictForTheClient() {
    Order order = order(OrderStatus.CANCELLED);
    order.restoreConcurrencyState(1L, false);
    assertThrows(InvalidOrderStateException.class, () -> service.cancelOwnOrder(id));
    verify(orders, never()).save(any());
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
  void missingOperationTimeCannotCancelOrSave() {
    Order order = order(OrderStatus.PENDING);
    when(clock.now()).thenReturn(null);

    assertThrows(IllegalArgumentException.class, () -> service.cancelOwnOrder(id));
    assertEquals(OrderStatus.PENDING, order.getStatus());
    assertNull(order.getCancelledAt());
    assertEquals(created, order.getUpdatedAt());
    verify(orders, never()).save(any());
    verifyNoInteractions(items);
  }

  @Test
  void theWorkerHasNoCancellationLeft() {
    var methods =
        Arrays.stream(com.santotofood.application.port.in.CancelOrderUseCase.class.getMethods())
            .map(java.lang.reflect.Method::getName)
            .toList();
    assertEquals(List.of("cancelOwnOrder"), methods);
    assertTrue(
        Arrays.stream(OrderService.class.getMethods())
            .noneMatch(method -> method.getName().equals("cancelOrder")));
    assertTrue(
        Arrays.stream(Order.class.getMethods())
            .noneMatch(method -> method.getName().equals("cancel")));
  }
}

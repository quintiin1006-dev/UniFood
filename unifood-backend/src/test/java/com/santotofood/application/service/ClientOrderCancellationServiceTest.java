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
    when(orders.findById(id)).thenReturn(Optional.of(order));
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
    assertEquals(now, order.getUpdatedAt());
    verify(orders).save(order);
  }

  @ParameterizedTest
  @EnumSource(value = OrderStatus.class, names = "PENDING", mode = EnumSource.Mode.EXCLUDE)
  void allOtherStatesAreRejectedByTheDomainAndNeverSaved(OrderStatus status) {
    Order order = order(status);
    assertThrows(InvalidOrderStateException.class, () -> order.cancelByClient(now));
    assertThrows(InvalidOrderStateException.class, () -> service.cancelOwnOrder(id));
    assertEquals(status, order.getStatus());
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
    verify(orders, never()).save(any());
  }
}

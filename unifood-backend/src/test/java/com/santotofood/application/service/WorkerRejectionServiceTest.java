package com.santotofood.application.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.santotofood.application.exception.OrderNotFoundException;
import com.santotofood.domain.exception.InvalidOrderStateException;
import com.santotofood.domain.exception.InvalidRejectionReasonException;
import com.santotofood.domain.model.Order;
import com.santotofood.domain.model.OrderStatus;
import com.santotofood.domain.port.out.*;
import com.santotofood.shared.error.ErrorCode;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;

class WorkerRejectionServiceTest {
  final OrderRepository orders = mock(OrderRepository.class);
  final OrderItemRepository items = mock(OrderItemRepository.class);
  final TimeProvider clock = mock(TimeProvider.class);
  final OrderService service = new OrderService(orders, items, clock);
  final UUID id = UUID.randomUUID();
  final UUID worker = UUID.randomUUID();
  final Instant created = Instant.parse("2026-11-20T15:00:00Z");
  final Instant now = created.plusSeconds(600);

  Order order(OrderStatus status) {
    Order order =
        Order.reconstitute(
            id,
            UUID.randomUUID(),
            UUID.randomUUID(),
            "Ana Torres",
            "1234567",
            "STUDENT",
            status,
            BigDecimal.TEN,
            created,
            created);
    when(orders.findByIdForUpdate(id)).thenReturn(Optional.of(order));
    when(orders.save(order)).thenReturn(order);
    when(items.findByOrderId(id)).thenReturn(List.of());
    when(clock.now()).thenReturn(now);
    return order;
  }

  @ParameterizedTest
  @EnumSource(
      value = OrderStatus.class,
      names = {"PENDING", "PREPARING"})
  void pendingAndPreparingOrdersAreRejectedUnderTheRowLockAndSavedOnce(OrderStatus status) {
    Order order = order(status);
    assertSame(order, service.rejectOrder(id, worker, " Se acabó el pollo "));
    assertEquals(OrderStatus.CANCELLED, order.getStatus());
    assertEquals("WORKER", order.getCancellationSource());
    assertEquals("Se acabó el pollo", order.getRejectionReason());
    assertEquals(worker, order.getRejectedBy());
    assertEquals(now, order.getCancelledAt());
    var sequence = inOrder(orders, clock);
    sequence.verify(orders).findByIdForUpdate(id);
    sequence.verify(clock).now();
    sequence.verify(orders).save(order);
  }

  @ParameterizedTest
  @EnumSource(
      value = OrderStatus.class,
      names = {"READY", "CALLED", "DELIVERED", "NOT_COLLECTED", "CANCELLED"})
  void everyOtherStateIsAConflictAndNeverSaved(OrderStatus status) {
    order(status);
    var refused =
        assertThrows(
            InvalidOrderStateException.class,
            () -> service.rejectOrder(id, worker, "Se acabó el pollo"));
    assertEquals(ErrorCode.INVALID_ORDER_STATE, refused.getCode());
    verify(orders, never()).save(any());
  }

  @Test
  void anInvalidReasonIsA400AndNeverSaved() {
    order(OrderStatus.PENDING);
    assertEquals(
        ErrorCode.REJECTION_REASON_REQUIRED,
        assertThrows(
                InvalidRejectionReasonException.class, () -> service.rejectOrder(id, worker, "   "))
            .getCode());
    assertEquals(
        ErrorCode.REJECTION_REASON_TOO_LONG,
        assertThrows(
                InvalidRejectionReasonException.class,
                () -> service.rejectOrder(id, worker, "x".repeat(201)))
            .getCode());
    verify(orders, never()).save(any());
  }

  @Test
  void theSameWorkersRepeatIsOkWithoutAnotherWrite() {
    Order order = order(OrderStatus.PENDING);
    service.rejectOrder(id, worker, "Se acabó el pollo");
    when(clock.now()).thenReturn(now.plusSeconds(60));
    assertSame(order, service.rejectOrder(id, worker, "Otro motivo"));
    assertEquals("Se acabó el pollo", order.getRejectionReason());
    assertEquals(now, order.getCancelledAt());
    verify(orders, times(1)).save(order);
    assertThrows(
        InvalidOrderStateException.class,
        () -> service.rejectOrder(id, UUID.randomUUID(), "Se acabó el pollo"));
  }

  @Test
  void aMissingOrderIsNotFound() {
    assertThrows(OrderNotFoundException.class, () -> service.rejectOrder(id, worker, "Motivo"));
    verify(orders, never()).save(any());
  }
}

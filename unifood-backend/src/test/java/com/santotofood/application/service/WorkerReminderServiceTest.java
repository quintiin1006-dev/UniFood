package com.santotofood.application.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.santotofood.application.exception.OrderNotFoundException;
import com.santotofood.domain.exception.InvalidOrderStateException;
import com.santotofood.domain.exception.NotCollectedRequirementsException;
import com.santotofood.domain.exception.ReminderLimitReachedException;
import com.santotofood.domain.exception.ReminderTooEarlyException;
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

/** The worker's reminder and manual "no recogido", always under the order's row lock. */
class WorkerReminderServiceTest {
  final OrderRepository orders = mock(OrderRepository.class);
  final OrderItemRepository items = mock(OrderItemRepository.class);
  final TimeProvider clock = mock(TimeProvider.class);
  final OrderService service = new OrderService(orders, items, clock);
  final UUID id = UUID.randomUUID();
  final Instant created = Instant.parse("2026-11-20T15:00:00Z");
  final Instant calledAt = created.plusSeconds(600);

  Order order(OrderStatus status, int reminders, Instant lastRemindedAt, Instant now) {
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
            status == OrderStatus.CALLED || status == OrderStatus.NOT_COLLECTED ? calledAt : null,
            reminders,
            lastRemindedAt,
            null,
            null,
            null,
            created,
            created);
    when(orders.findByIdForUpdate(id)).thenReturn(Optional.of(order));
    when(orders.save(order)).thenReturn(order);
    when(items.findByOrderId(id)).thenReturn(List.of());
    when(clock.now()).thenReturn(now);
    return order;
  }

  @Test
  void aReminderFiveMinutesAfterTheCallIsCountedAndSavedOnce() {
    Instant now = calledAt.plusSeconds(300);
    Order order = order(OrderStatus.CALLED, 0, null, now);
    assertSame(order, service.remindStudent(id));
    assertEquals(1, order.getReminderCount());
    assertEquals(now, order.getLastRemindedAt());
    var sequence = inOrder(orders, clock);
    sequence.verify(orders).findByIdForUpdate(id);
    sequence.verify(clock).now();
    sequence.verify(orders).save(order);
  }

  @Test
  void aReminderBeforeFiveMinutesIsTooEarlyAndWritesNothing() {
    order(OrderStatus.CALLED, 0, null, calledAt.plusSeconds(299));
    var error = assertThrows(ReminderTooEarlyException.class, () -> service.remindStudent(id));
    assertEquals(ErrorCode.REMINDER_TOO_EARLY, error.getCode());
    verify(orders, never()).save(any());
  }

  @Test
  void repeatingAReminderRightAwayCountsFromThePreviousOneAndIsTooEarly() {
    Instant first = calledAt.plusSeconds(300);
    order(OrderStatus.CALLED, 1, first, first.plusSeconds(10));
    assertThrows(ReminderTooEarlyException.class, () -> service.remindStudent(id));
    verify(orders, never()).save(any());
  }

  @Test
  void aFourthReminderReachesTheLimitAndWritesNothing() {
    Instant third = calledAt.plusSeconds(900);
    order(OrderStatus.CALLED, 3, third, third.plusSeconds(3600));
    var error = assertThrows(ReminderLimitReachedException.class, () -> service.remindStudent(id));
    assertEquals(ErrorCode.REMINDER_LIMIT_REACHED, error.getCode());
    verify(orders, never()).save(any());
  }

  @ParameterizedTest
  @EnumSource(
      value = OrderStatus.class,
      names = {"CALLED"},
      mode = EnumSource.Mode.EXCLUDE)
  void onlyACalledOrderCanBeRemindedOrMarkedNotCollected(OrderStatus status) {
    order(status, 3, null, calledAt.plusSeconds(3600));
    var remind = assertThrows(InvalidOrderStateException.class, () -> service.remindStudent(id));
    assertEquals(ErrorCode.INVALID_ORDER_STATE, remind.getCode());
    var mark =
        assertThrows(InvalidOrderStateException.class, () -> service.markOrderNotCollected(id));
    assertEquals(ErrorCode.INVALID_ORDER_STATE, mark.getCode());
    verify(orders, never()).save(any());
  }

  @Test
  void notCollectedNeedsTheThreeRemindersAndWritesNothingBefore() {
    order(OrderStatus.CALLED, 2, calledAt.plusSeconds(600), calledAt.plusSeconds(3600));
    var error =
        assertThrows(
            NotCollectedRequirementsException.class, () -> service.markOrderNotCollected(id));
    assertEquals(ErrorCode.NOT_COLLECTED_REQUIREMENTS_NOT_MET, error.getCode());
    verify(orders, never()).save(any());
  }

  @Test
  void afterTheThreeRemindersTheOrderIsNotCollectedAndRepeatingItIsAConflict() {
    Instant now = calledAt.plusSeconds(3600);
    Order order = order(OrderStatus.CALLED, 3, calledAt.plusSeconds(900), now);
    assertSame(order, service.markOrderNotCollected(id));
    assertEquals(OrderStatus.NOT_COLLECTED, order.getStatus());
    assertEquals(now, order.getNotCollectedAt());
    verify(orders).save(order);
    assertThrows(InvalidOrderStateException.class, () -> service.markOrderNotCollected(id));
    assertThrows(InvalidOrderStateException.class, () -> service.remindStudent(id));
    verify(orders, times(1)).save(any());
  }

  @Test
  void aMissingOrderIsNotFoundForBothActions() {
    when(orders.findByIdForUpdate(id)).thenReturn(Optional.empty());
    assertThrows(OrderNotFoundException.class, () -> service.remindStudent(id));
    assertThrows(OrderNotFoundException.class, () -> service.markOrderNotCollected(id));
    verify(orders, never()).save(any());
  }
}

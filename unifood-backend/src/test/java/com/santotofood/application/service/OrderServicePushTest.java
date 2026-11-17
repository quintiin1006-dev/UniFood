package com.santotofood.application.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.santotofood.domain.model.Order;
import com.santotofood.domain.model.OrderPushEvent;
import com.santotofood.domain.model.OrderPushEvent.Kind;
import com.santotofood.domain.model.OrderStatus;
import com.santotofood.domain.port.out.OrderItemRepository;
import com.santotofood.domain.port.out.OrderRepository;
import com.santotofood.domain.port.out.PushNotificationPort;
import com.santotofood.domain.port.out.TimeProvider;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** Each worker transition publishes its notice once, after saving; push never affects it. */
class OrderServicePushTest {
  final OrderRepository orders = mock(OrderRepository.class);
  final OrderItemRepository items = mock(OrderItemRepository.class);
  final TimeProvider clock = mock(TimeProvider.class);
  final List<OrderPushEvent> published = new ArrayList<>();
  final OrderService service = new OrderService(orders, items, clock, published::add);
  final UUID id = UUID.randomUUID();
  final UUID cafeteria = UUID.randomUUID();
  final Instant created = Instant.parse("2026-11-20T15:00:00Z");

  Order order(OrderStatus status, Instant calledAt, int reminders) {
    Order order =
        Order.reconstitute(
            id,
            cafeteria,
            UUID.randomUUID(),
            "Ana Torres",
            "1234567",
            "STUDENT",
            status,
            BigDecimal.TEN,
            calledAt,
            reminders,
            null,
            null,
            null,
            null,
            created,
            created);
    when(orders.findByIdForUpdate(id)).thenReturn(Optional.of(order));
    when(orders.findCafeteriaId(id)).thenReturn(Optional.of(cafeteria));
    when(orders.findFirstPendingByCafeteriaId(eq(cafeteria), any(), any()))
        .thenReturn(Optional.of(order));
    when(orders.save(order)).thenReturn(order);
    when(items.findByOrderId(id)).thenReturn(List.of());
    return order;
  }

  @Test
  void everyNotifiedTransitionPublishesItsEventAfterTheSave() {
    when(clock.now()).thenReturn(created.plusSeconds(60));
    order(OrderStatus.PENDING, null, 0);
    service.prepareOrder(id);
    service.markOrderReady(id);
    service.callStudent(id);
    assertEquals(
        List.of(
            OrderPushEvent.of(id, Kind.PREPARING),
            OrderPushEvent.of(id, Kind.READY),
            OrderPushEvent.of(id, Kind.CALLED)),
        published);
    verify(orders, times(3)).save(any());
  }

  @Test
  void eachReminderIsItsOwnNumberedEvent() {
    Instant called = created.plusSeconds(600);
    order(OrderStatus.CALLED, called, 0);
    when(clock.now()).thenReturn(called.plusSeconds(300));
    service.remindStudent(id);
    when(clock.now()).thenReturn(called.plusSeconds(600));
    service.remindStudent(id);
    assertEquals(
        List.of(new OrderPushEvent(id, Kind.REMINDER, 1), new OrderPushEvent(id, Kind.REMINDER, 2)),
        published);
  }

  @Test
  void aRejectionNotifiesOnlyWhenItChangedTheOrder() {
    when(clock.now()).thenReturn(created.plusSeconds(60));
    order(OrderStatus.PENDING, null, 0);
    UUID worker = UUID.randomUUID();
    service.rejectOrder(id, worker, "Sin existencias");
    service.rejectOrder(id, worker, "Sin existencias"); // idempotent repeat: no second notice
    assertEquals(List.of(OrderPushEvent.of(id, Kind.REJECTED)), published);
  }

  @Test
  void theClientsOwnCancellationAndTheDeliveryNeverNotify() {
    when(clock.now()).thenReturn(created.plusSeconds(60));
    order(OrderStatus.PENDING, null, 0);
    service.cancelOwnOrder(id);
    Instant called = created.plusSeconds(600);
    order(OrderStatus.CALLED, called, 0);
    when(clock.now()).thenReturn(called.plusSeconds(10));
    service.deliverOrder(id);
    assertTrue(published.isEmpty());
  }

  @Test
  void aFailingPushPortNeverBreaksTheTransition() {
    when(clock.now()).thenReturn(created.plusSeconds(60));
    Order order = order(OrderStatus.PREPARING, null, 0);
    PushNotificationPort broken =
        event -> {
          throw new IllegalStateException("push exploded");
        };
    // Even a port that breaks its never-throw contract cannot fail or roll back the transition.
    var withBrokenPush = new OrderService(orders, items, clock, broken);
    assertSame(order, assertDoesNotThrow(() -> withBrokenPush.markOrderReady(id)));
    verify(orders).save(order);
    assertEquals(OrderStatus.READY, order.getStatus());
  }
}

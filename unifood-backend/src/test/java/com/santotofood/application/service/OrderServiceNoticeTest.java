package com.santotofood.application.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.santotofood.application.model.OrderNoticeKind;
import com.santotofood.domain.model.Order;
import com.santotofood.domain.model.OrderPushEvent;
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

/** Every client-facing transition stores its inbox notice; the inbox never affects the order. */
class OrderServiceNoticeTest {
  record Recorded(UUID orderId, OrderNoticeKind kind, int sequence, Instant at) {}

  final OrderRepository orders = mock(OrderRepository.class);
  final OrderItemRepository items = mock(OrderItemRepository.class);
  final TimeProvider clock = mock(TimeProvider.class);
  final List<Recorded> recorded = new ArrayList<>();
  final OrderService service =
      new OrderService(
          orders,
          items,
          clock,
          PushNotificationPort.NONE,
          (orderId, kind, sequence, at) -> recorded.add(new Recorded(orderId, kind, sequence, at)));
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

  List<OrderNoticeKind> kinds() {
    return recorded.stream().map(Recorded::kind).toList();
  }

  @Test
  void preparingReadyAndCalledAreStoredWithTheTransitionTime() {
    Instant now = created.plusSeconds(60);
    when(clock.now()).thenReturn(now);
    order(OrderStatus.PENDING, null, 0);
    service.prepareOrder(id);
    service.markOrderReady(id);
    service.callStudent(id);
    assertEquals(
        List.of(
            new Recorded(id, OrderNoticeKind.PREPARING, 0, now),
            new Recorded(id, OrderNoticeKind.READY, 0, now),
            new Recorded(id, OrderNoticeKind.CALLED, 0, now)),
        recorded);
  }

  @Test
  void twoRemindersInARowAreTwoNumberedNotices() {
    Instant called = created.plusSeconds(600);
    order(OrderStatus.CALLED, called, 0);
    when(clock.now()).thenReturn(called.plusSeconds(300));
    service.remindStudent(id);
    when(clock.now()).thenReturn(called.plusSeconds(600));
    service.remindStudent(id);
    assertEquals(
        List.of(
            new Recorded(id, OrderNoticeKind.REMINDER, 1, called.plusSeconds(300)),
            new Recorded(id, OrderNoticeKind.REMINDER, 2, called.plusSeconds(600))),
        recorded);
  }

  @Test
  void deliveryAndWorkerNotCollectedAreStored() {
    Instant called = created.plusSeconds(600);
    order(OrderStatus.CALLED, called, 0);
    when(clock.now()).thenReturn(called.plusSeconds(10));
    service.deliverOrder(id);
    assertEquals(List.of(OrderNoticeKind.DELIVERED), kinds());

    recorded.clear();
    order(OrderStatus.CALLED, called, Order.MAX_REMINDERS);
    when(clock.now()).thenReturn(called.plusSeconds(3600));
    service.markOrderNotCollected(id);
    assertEquals(List.of(OrderNoticeKind.NOT_COLLECTED), kinds());
  }

  @Test
  void rejectionAndOwnCancellationAreDistinctKindsAndRepeatsStoreNothing() {
    when(clock.now()).thenReturn(created.plusSeconds(60));
    order(OrderStatus.PENDING, null, 0);
    UUID worker = UUID.randomUUID();
    service.rejectOrder(id, worker, "Sin existencias");
    service.rejectOrder(id, worker, "Sin existencias");
    assertEquals(List.of(OrderNoticeKind.REJECTED), kinds());

    recorded.clear();
    order(OrderStatus.PENDING, null, 0);
    service.cancelOwnOrder(id);
    service.cancelOwnOrder(id);
    assertEquals(List.of(OrderNoticeKind.CANCELLED_BY_CLIENT), kinds());
  }

  @Test
  void aStatusKindWithoutInboxEquivalentConfirmsTheTransitionAndStoresNoNotice() {
    Instant called = created.plusSeconds(600);
    Order order = order(OrderStatus.CALLED, called, 0);
    when(clock.now()).thenReturn(called.plusSeconds(10));
    var workersOnly = Optional.of(OrderPushEvent.of(id, OrderPushEvent.Kind.NEW_ORDER));
    try (var events = mockStatic(OrderPushEvent.class, CALLS_REAL_METHODS)) {
      events.when(() -> OrderPushEvent.forStatus(any())).thenReturn(workersOnly);
      assertDoesNotThrow(() -> service.deliverOrder(id));
    }
    assertEquals(OrderStatus.DELIVERED, order.getStatus());
    verify(orders).save(order);
    assertTrue(recorded.isEmpty());
  }

  @Test
  void everyClientStatusKindMapsExplicitlyAndTheWorkersKindDoesNot() {
    for (OrderStatus status : OrderStatus.values()) {
      var event = OrderPushEvent.forStatus(order(status, null, 0));
      event.ifPresent(
          e -> assertTrue(OrderService.noticeKind(e.kind()).isPresent(), status.name()));
    }
    assertTrue(OrderService.noticeKind(OrderPushEvent.Kind.NEW_ORDER).isEmpty());
    assertTrue(OrderService.noticeKind(null).isEmpty());
  }

  @Test
  void aFailingRecorderNeverBreaksTheTransition() {
    Instant called = created.plusSeconds(600);
    Order order = order(OrderStatus.CALLED, called, 0);
    when(clock.now()).thenReturn(called.plusSeconds(10));
    var broken =
        new OrderService(
            orders,
            items,
            clock,
            PushNotificationPort.NONE,
            (orderId, kind, sequence, at) -> {
              throw new IllegalStateException("inbox down");
            });
    assertDoesNotThrow(() -> broken.deliverOrder(id));
    assertEquals(OrderStatus.DELIVERED, order.getStatus());
    verify(orders).save(order);
  }
}

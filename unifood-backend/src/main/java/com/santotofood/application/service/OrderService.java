package com.santotofood.application.service;

import com.santotofood.application.exception.OrderNotFoundException;
import com.santotofood.application.exception.OrderProcessingSequenceException;
import com.santotofood.application.model.OperationalOrders;
import com.santotofood.application.model.OrderNoticeKind;
import com.santotofood.application.port.in.CallStudentUseCase;
import com.santotofood.application.port.in.CancelOrderUseCase;
import com.santotofood.application.port.in.DeliverOrderUseCase;
import com.santotofood.application.port.in.GetOrdersByCafeteriaUseCase;
import com.santotofood.application.port.in.MarkOrderNotCollectedUseCase;
import com.santotofood.application.port.in.MarkOrderReadyUseCase;
import com.santotofood.application.port.in.PrepareOrderUseCase;
import com.santotofood.application.port.in.RejectOrderUseCase;
import com.santotofood.application.port.in.RemindStudentUseCase;
import com.santotofood.domain.exception.OrderConflictException;
import com.santotofood.domain.model.BusinessDate;
import com.santotofood.domain.model.Order;
import com.santotofood.domain.model.OrderItem;
import com.santotofood.domain.model.OrderPushEvent;
import com.santotofood.domain.port.out.OrderItemRepository;
import com.santotofood.domain.port.out.OrderRepository;
import com.santotofood.domain.port.out.PushNotificationPort;
import com.santotofood.domain.port.out.TimeProvider;
import com.santotofood.shared.error.ErrorCode;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class OrderService
    implements PrepareOrderUseCase,
        MarkOrderReadyUseCase,
        CallStudentUseCase,
        RemindStudentUseCase,
        DeliverOrderUseCase,
        MarkOrderNotCollectedUseCase,
        CancelOrderUseCase,
        RejectOrderUseCase,
        GetOrdersByCafeteriaUseCase {

  private static final org.slf4j.Logger LOG = org.slf4j.LoggerFactory.getLogger(OrderService.class);

  private final OrderRepository orderRepository;
  private final OrderItemRepository orderItemRepository;
  private final TimeProvider timeProvider;
  private final PushNotificationPort push;
  private final OrderNoticeRecorder notices;

  public OrderService(
      OrderRepository orderRepository,
      OrderItemRepository orderItemRepository,
      TimeProvider timeProvider) {
    this(orderRepository, orderItemRepository, timeProvider, PushNotificationPort.NONE);
  }

  /** Spring: push is optional, so a context without the push module still builds. */
  @Autowired
  public OrderService(
      OrderRepository orderRepository,
      OrderItemRepository orderItemRepository,
      TimeProvider timeProvider,
      java.util.Optional<PushNotificationPort> push,
      java.util.Optional<OrderNoticeRecorder> notices) {
    this(
        orderRepository,
        orderItemRepository,
        timeProvider,
        push.orElse(PushNotificationPort.NONE),
        notices.orElse(OrderNoticeRecorder.NONE));
  }

  public OrderService(
      OrderRepository orderRepository,
      OrderItemRepository orderItemRepository,
      TimeProvider timeProvider,
      PushNotificationPort push) {
    this(orderRepository, orderItemRepository, timeProvider, push, OrderNoticeRecorder.NONE);
  }

  public OrderService(
      OrderRepository orderRepository,
      OrderItemRepository orderItemRepository,
      TimeProvider timeProvider,
      PushNotificationPort push,
      OrderNoticeRecorder notices) {
    this.orderRepository = orderRepository;
    this.orderItemRepository = orderItemRepository;
    this.timeProvider = timeProvider;
    this.push = push;
    this.notices = notices;
  }

  @Override
  @Transactional
  public Order prepareOrder(UUID orderId) {

    // The projection deliberately avoids caching an unlocked JPA entity.
    UUID cafeteriaId =
        orderRepository
            .findCafeteriaId(orderId)
            .orElseThrow(() -> new OrderNotFoundException(orderId));
    orderRepository.lockCafeteriaQueue(cafeteriaId);
    Order order = findOrder(orderId);
    if (!cafeteriaId.equals(order.getCafeteriaId())) {
      throw new OrderConflictException(ErrorCode.ORDER_CONCURRENT_MODIFICATION);
    }
    Instant now = timeProvider.now();
    // Validate the authoritative state before FIFO; a cancelled queue is a domain conflict.
    order.prepare(now);

    // §6: the queue only considers today's orders in America/Bogota, so a PENDING order left
    // from another day (the daily close cancels it) never blocks today's first order.
    var day = BusinessDate.from(now);
    Order firstPendingOrder =
        orderRepository
            .findFirstPendingByCafeteriaId(
                order.getCafeteriaId(), day.dayStartInstant(), day.nextDayStartInstant())
            .orElseThrow(() -> new OrderProcessingSequenceException());

    if (!firstPendingOrder.getId().equals(order.getId())) {
      throw new OrderProcessingSequenceException();
    }

    Order savedOrder = orderRepository.save(order);
    publishStatus(savedOrder);

    return loadOrderItems(savedOrder);
  }

  @Override
  @Transactional
  public Order markOrderReady(UUID orderId) {

    Order order = findOrder(orderId);

    Instant now = timeProvider.now();

    order.markReady(now);

    Order savedOrder = orderRepository.save(order);
    publishStatus(savedOrder);

    return loadOrderItems(savedOrder);
  }

  @Override
  @Transactional
  public Order callStudent(UUID orderId) {

    Order order = findOrder(orderId);

    Instant now = timeProvider.now();

    order.callStudent(now);

    Order savedOrder = orderRepository.save(order);
    publishStatus(savedOrder);

    return loadOrderItems(savedOrder);
  }

  @Override
  @Transactional
  public Order remindStudent(UUID orderId) {

    Order order = findOrder(orderId);

    Instant now = timeProvider.now();

    order.remindStudent(now);

    Order savedOrder = orderRepository.save(order);
    // One push and one notice per reminder number: a retried request never repeats a reminder.
    recordNotice(savedOrder.getId(), OrderNoticeKind.REMINDER, savedOrder.getReminderCount());
    notify(
        () ->
            new OrderPushEvent(
                savedOrder.getId(), OrderPushEvent.Kind.REMINDER, savedOrder.getReminderCount()));

    return loadOrderItems(savedOrder);
  }

  @Override
  @Transactional
  public Order deliverOrder(UUID orderId) {

    Order order = findOrder(orderId);

    Instant now = timeProvider.now();

    order.deliver(now);

    Order savedOrder = orderRepository.save(order);
    publishStatus(savedOrder);

    return loadOrderItems(savedOrder);
  }

  @Override
  @Transactional
  public Order markOrderNotCollected(UUID orderId) {

    Order order = findOrder(orderId);

    Instant now = timeProvider.now();

    order.markNotCollected(now);

    Order savedOrder = orderRepository.save(order);
    publishStatus(savedOrder);

    return loadOrderItems(savedOrder);
  }

  @Override
  @Transactional
  public Order rejectOrder(UUID orderId, UUID workerId, String reason) {
    // The row lock serializes it with the client's cancellation and the worker's transitions.
    Order order = findOrder(orderId);
    if (!order.rejectByWorker(workerId, reason, timeProvider.now())) return loadOrderItems(order);
    Order saved = orderRepository.save(order);
    recordNotice(saved.getId(), OrderNoticeKind.REJECTED, 0);
    notify(() -> OrderPushEvent.of(saved.getId(), OrderPushEvent.Kind.REJECTED));
    return loadOrderItems(saved);
  }

  @Override
  @Transactional
  public Order cancelOwnOrder(UUID orderId) {
    Order order = findOrder(orderId);
    if (!order.cancelByClient(timeProvider.now())) return loadOrderItems(order);
    Order saved = orderRepository.save(order);
    // Inbox only: the client's own cancellation never pushes.
    recordNotice(saved.getId(), OrderNoticeKind.CANCELLED_BY_CLIENT, 0);
    return loadOrderItems(saved);
  }

  @Override
  @Transactional(readOnly = true)
  public List<Order> getOrdersByCafeteria(UUID cafeteriaId) {
    return getOperationalOrders(cafeteriaId).orders();
  }

  @Override
  @Transactional(readOnly = true, timeout = 15)
  public OperationalOrders getOperationalOrders(UUID cafeteriaId) {
    var date = BusinessDate.from(timeProvider.now());

    List<Order> orders =
        orderRepository.findOperational(
            cafeteriaId, date.dayStartInstant(), date.nextDayStartInstant());

    if (orders.isEmpty()) {
      return new OperationalOrders(date, orders);
    }

    List<UUID> orderIds = orders.stream().map(Order::getId).toList();

    List<OrderItem> items = orderItemRepository.findByOrderIds(orderIds);

    Map<UUID, List<OrderItem>> itemsByOrderId =
        items.stream().collect(Collectors.groupingBy(OrderItem::getOrderId));

    orders.forEach(order -> order.setItems(itemsByOrderId.getOrDefault(order.getId(), List.of())));

    return new OperationalOrders(date, orders);
  }

  /**
   * Queued for after the commit by the port; a rollback sends nothing. The client's own
   * cancellation and the daily close never push (docs/notificaciones-push.md).
   */
  private void publishStatus(Order saved) {
    recordNotice(
        saved.getId(),
        () -> OrderPushEvent.forStatus(saved).flatMap(e -> noticeKind(e.kind())).orElse(null),
        0);
    notify(() -> OrderPushEvent.forStatus(saved).orElse(null));
  }

  /** Explicit mapping; a push kind without an inbox equivalent stores no notice. */
  static java.util.Optional<OrderNoticeKind> noticeKind(OrderPushEvent.Kind kind) {
    if (kind == null) return java.util.Optional.empty();
    return switch (kind) {
      case PREPARING -> java.util.Optional.of(OrderNoticeKind.PREPARING);
      case READY -> java.util.Optional.of(OrderNoticeKind.READY);
      case CALLED -> java.util.Optional.of(OrderNoticeKind.CALLED);
      case REMINDER -> java.util.Optional.of(OrderNoticeKind.REMINDER);
      case DELIVERED -> java.util.Optional.of(OrderNoticeKind.DELIVERED);
      case NOT_COLLECTED -> java.util.Optional.of(OrderNoticeKind.NOT_COLLECTED);
      case REJECTED -> java.util.Optional.of(OrderNoticeKind.REJECTED);
      default -> java.util.Optional.empty(); // NEW_ORDER (workers) and any later kind
    };
  }

  private void recordNotice(UUID orderId, OrderNoticeKind kind, int sequence) {
    recordNotice(orderId, () -> kind, sequence);
  }

  /**
   * Same transaction as the transition; computing the kind and recording both run inside the try,
   * so nothing here can throw or abort the transition. A null kind records nothing.
   */
  private void recordNotice(
      UUID orderId, java.util.function.Supplier<OrderNoticeKind> kind, int sequence) {
    try {
      var computed = kind.get();
      if (computed != null) notices.record(orderId, computed, sequence, timeProvider.now());
    } catch (RuntimeException failure) {
      LOG.warn("Order notice not recorded ({})", failure.getClass().getSimpleName());
    }
  }

  /** Defense in depth: no push failure can roll back, fail or delay the transition. */
  private void notify(java.util.function.Supplier<OrderPushEvent> event) {
    try {
      var computed = event.get();
      if (computed != null) push.publish(computed);
    } catch (RuntimeException failure) {
      LOG.warn("Push notice not scheduled ({})", failure.getClass().getSimpleName());
    }
  }

  private Order loadOrderItems(Order order) {

    List<OrderItem> items = orderItemRepository.findByOrderId(order.getId());

    order.setItems(items);

    return order;
  }

  private Order findOrder(UUID orderId) {

    return orderRepository
        .findByIdForUpdate(orderId)
        .orElseThrow(() -> new OrderNotFoundException(orderId));
  }
}

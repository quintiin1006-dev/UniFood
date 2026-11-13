package com.santotofood.application.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.*;

import com.santotofood.application.exception.OrderNotFoundException;
import com.santotofood.application.exception.OrderProcessingSequenceException;
import com.santotofood.domain.model.Order;
import com.santotofood.domain.port.out.OrderItemRepository;
import com.santotofood.domain.port.out.OrderRepository;
import com.santotofood.domain.port.out.TimeProvider;
import com.santotofood.shared.error.ErrorCode;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class OrderServiceTest {

  private OrderRepository orderRepository;
  private OrderItemRepository orderItemRepository;
  private TimeProvider timeProvider;
  private OrderService orderService;

  @BeforeEach
  void setUp() {
    orderRepository = mock(OrderRepository.class);
    orderItemRepository = mock(OrderItemRepository.class);
    timeProvider = mock(TimeProvider.class);

    orderService = new OrderService(orderRepository, orderItemRepository, timeProvider);
  }

  @Test
  void shouldThrowOrderNotFoundExceptionWhenOrderDoesNotExist() {

    UUID orderId = UUID.fromString("11111111-1111-1111-1111-111111111111");

    when(orderRepository.findCafeteriaId(orderId)).thenReturn(Optional.empty());

    OrderNotFoundException exception =
        assertThrows(OrderNotFoundException.class, () -> orderService.prepareOrder(orderId));

    assertEquals(ErrorCode.ORDER_NOT_FOUND, exception.getCode());

    assertEquals("No existe un pedido con id " + orderId, exception.getMessage());
  }

  @Test
  void shouldThrowOrderProcessingSequenceExceptionWhenOrderIsNotFirstPending() {

    UUID orderId = UUID.fromString("11111111-1111-1111-1111-111111111111");

    UUID firstPendingOrderId = UUID.fromString("22222222-2222-2222-2222-222222222222");

    UUID cafeteriaId = UUID.fromString("33333333-3333-3333-3333-333333333333");

    Order requestedOrder = mock(Order.class);
    Order firstPendingOrder = mock(Order.class);

    when(orderRepository.findCafeteriaId(orderId)).thenReturn(Optional.of(cafeteriaId));
    when(orderRepository.findByIdForUpdate(orderId)).thenReturn(Optional.of(requestedOrder));

    when(requestedOrder.getId()).thenReturn(orderId);

    when(requestedOrder.getCafeteriaId()).thenReturn(cafeteriaId);

    when(orderRepository.findFirstPendingByCafeteriaId(cafeteriaId))
        .thenReturn(Optional.of(firstPendingOrder));

    when(firstPendingOrder.getId()).thenReturn(firstPendingOrderId);

    OrderProcessingSequenceException exception =
        assertThrows(
            OrderProcessingSequenceException.class, () -> orderService.prepareOrder(orderId));

    assertEquals(ErrorCode.ORDER_PROCESSING_SEQUENCE_VIOLATION, exception.getCode());

    assertEquals(
        "No puedes preparar este pedido todavía. "
            + "El pedido anterior debe ser procesado primero.",
        exception.getMessage());

    verify(timeProvider).now();
    verify(orderRepository, never()).save(any());
  }

  @Test
  void operationalOrdersUseTheBogotaBusinessDayAndLoadEveryItemInOneQuery() {
    UUID cafeteriaId = UUID.randomUUID();
    // 2026-11-20 at 04:00Z is still 2026-11-19 in America/Bogota.
    when(timeProvider.now()).thenReturn(java.time.Instant.parse("2026-11-20T04:00:00Z"));
    Order first = mock(Order.class);
    Order second = mock(Order.class);
    UUID firstId = UUID.randomUUID();
    UUID secondId = UUID.randomUUID();
    when(first.getId()).thenReturn(firstId);
    when(second.getId()).thenReturn(secondId);
    var item = mock(com.santotofood.domain.model.OrderItem.class);
    when(item.getOrderId()).thenReturn(firstId);
    when(orderRepository.findOperational(
            cafeteriaId,
            java.time.Instant.parse("2026-11-19T05:00:00Z"),
            java.time.Instant.parse("2026-11-20T05:00:00Z")))
        .thenReturn(java.util.List.of(first, second));
    when(orderItemRepository.findByOrderIds(java.util.List.of(firstId, secondId)))
        .thenReturn(java.util.List.of(item));

    var listing = orderService.getOperationalOrders(cafeteriaId);

    assertEquals(java.time.LocalDate.of(2026, 11, 19), listing.businessDate().value());
    assertEquals(java.util.List.of(first, second), listing.orders());
    verify(first).setItems(java.util.List.of(item));
    verify(second).setItems(java.util.List.of());
    verify(orderItemRepository).findByOrderIds(any());
    verifyNoMoreInteractions(orderItemRepository);
  }

  @Test
  void operationalOrdersRunInAReadOnlyTransactionWithThe15SecondTimeout() throws Exception {
    var annotation =
        OrderService.class
            .getMethod("getOperationalOrders", UUID.class)
            .getAnnotation(org.springframework.transaction.annotation.Transactional.class);
    assertEquals(true, annotation.readOnly());
    assertEquals(15, annotation.timeout());
  }
}

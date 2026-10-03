package com.santotofood.application.service;

import com.santotofood.application.exception.OrderNotFoundException;
import com.santotofood.application.exception.OrderProcessingSequenceException;
import com.santotofood.domain.model.Order;
import com.santotofood.domain.port.out.OrderItemRepository;
import com.santotofood.domain.port.out.OrderRepository;
import com.santotofood.domain.port.out.TimeProvider;
import com.santotofood.shared.error.ErrorCode;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.*;

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

        orderService = new OrderService(
                orderRepository,
                orderItemRepository,
                timeProvider
        );
    }

    @Test
    void shouldThrowOrderNotFoundExceptionWhenOrderDoesNotExist() {

        UUID orderId =
                UUID.fromString(
                        "11111111-1111-1111-1111-111111111111"
                );

        when(orderRepository.findById(orderId))
                .thenReturn(Optional.empty());

        OrderNotFoundException exception =
                assertThrows(
                        OrderNotFoundException.class,
                        () -> orderService.prepareOrder(orderId)
                );

        assertEquals(
                ErrorCode.ORDER_NOT_FOUND,
                exception.getCode()
        );

        assertEquals(
                "No existe un pedido con id " + orderId,
                exception.getMessage()
        );
    }

    @Test
    void shouldThrowOrderProcessingSequenceExceptionWhenOrderIsNotFirstPending() {

        UUID orderId =
                UUID.fromString(
                        "11111111-1111-1111-1111-111111111111"
                );

        UUID firstPendingOrderId =
                UUID.fromString(
                        "22222222-2222-2222-2222-222222222222"
                );

        UUID cafeteriaId =
                UUID.fromString(
                        "33333333-3333-3333-3333-333333333333"
                );

        Order requestedOrder = mock(Order.class);
        Order firstPendingOrder = mock(Order.class);

        when(orderRepository.findById(orderId))
                .thenReturn(Optional.of(requestedOrder));

        when(requestedOrder.getId())
                .thenReturn(orderId);

        when(requestedOrder.getCafeteriaId())
                .thenReturn(cafeteriaId);

        when(
                orderRepository.findFirstPendingByCafeteriaId(
                        cafeteriaId
                )
        ).thenReturn(
                Optional.of(firstPendingOrder)
        );

        when(firstPendingOrder.getId())
                .thenReturn(firstPendingOrderId);

        OrderProcessingSequenceException exception =
                assertThrows(
                        OrderProcessingSequenceException.class,
                        () -> orderService.prepareOrder(orderId)
                );

        assertEquals(
                ErrorCode.ORDER_PROCESSING_SEQUENCE_VIOLATION,
                exception.getCode()
        );

        assertEquals(
                "No puedes preparar este pedido todavía. " +
                        "El pedido anterior debe ser procesado primero.",
                exception.getMessage()
        );

        verify(timeProvider, never()).now();
        verify(orderRepository, never()).save(any());
    }
}
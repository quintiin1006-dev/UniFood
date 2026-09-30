package com.santotofood.application.service;

import com.santotofood.application.exception.OrderNotFoundException;
import com.santotofood.application.port.in.CallStudentUseCase;
import com.santotofood.application.port.in.CancelOrderUseCase;
import com.santotofood.application.port.in.DeliverOrderUseCase;
import com.santotofood.application.port.in.GetOrdersByCafeteriaUseCase;
import com.santotofood.application.port.in.MarkOrderNotCollectedUseCase;
import com.santotofood.application.port.in.MarkOrderReadyUseCase;
import com.santotofood.application.port.in.PrepareOrderUseCase;
import com.santotofood.application.port.in.RemindStudentUseCase;
import com.santotofood.domain.model.Order;
import com.santotofood.domain.model.OrderItem;
import com.santotofood.domain.port.out.OrderItemRepository;
import com.santotofood.domain.port.out.OrderRepository;
import com.santotofood.domain.port.out.TimeProvider;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

@Service
public class OrderService implements
        PrepareOrderUseCase,
        MarkOrderReadyUseCase,
        CallStudentUseCase,
        RemindStudentUseCase,
        DeliverOrderUseCase,
        MarkOrderNotCollectedUseCase,
        CancelOrderUseCase,
        GetOrdersByCafeteriaUseCase {

    private final OrderRepository orderRepository;
    private final OrderItemRepository orderItemRepository;
    private final TimeProvider timeProvider;

    public OrderService(
            OrderRepository orderRepository,
            OrderItemRepository orderItemRepository,
            TimeProvider timeProvider
    ) {
        this.orderRepository = orderRepository;
        this.orderItemRepository = orderItemRepository;
        this.timeProvider = timeProvider;
    }

    @Override
    @Transactional
    public Order prepareOrder(UUID orderId) {

        Order order = findOrder(orderId);

        Order firstPendingOrder =
                orderRepository
                        .findFirstPendingByCafeteriaId(
                                order.getCafeteriaId()
                        )
                        .orElseThrow(() ->
                                new IllegalStateException(
                                        "No hay pedidos pendientes"
                                )
                        );

        if (!firstPendingOrder.getId().equals(order.getId())) {
            throw new IllegalStateException(
                    "No puedes preparar este pedido todavía. " +
                            "El pedido anterior debe ser procesado primero."
            );
        }

        Instant now = timeProvider.now();

        order.prepare(now);

        Order savedOrder =
                orderRepository.save(order);

        return loadOrderItems(savedOrder);
    }

    @Override
    @Transactional
    public Order markOrderReady(UUID orderId) {

        Order order = findOrder(orderId);

        Instant now = timeProvider.now();

        order.markReady(now);

        Order savedOrder =
                orderRepository.save(order);

        return loadOrderItems(savedOrder);
    }

    @Override
    @Transactional
    public Order callStudent(UUID orderId) {

        Order order = findOrder(orderId);

        Instant now = timeProvider.now();

        order.callStudent(now);

        Order savedOrder =
                orderRepository.save(order);

        return loadOrderItems(savedOrder);
    }

    @Override
    @Transactional
    public Order remindStudent(UUID orderId) {

        Order order = findOrder(orderId);

        Instant now = timeProvider.now();

        order.remindStudent(now);

        Order savedOrder =
                orderRepository.save(order);

        return loadOrderItems(savedOrder);
    }

    @Override
    @Transactional
    public Order deliverOrder(UUID orderId) {

        Order order = findOrder(orderId);

        Instant now = timeProvider.now();

        order.deliver(now);

        Order savedOrder =
                orderRepository.save(order);

        return loadOrderItems(savedOrder);
    }

    @Override
    @Transactional
    public Order markOrderNotCollected(UUID orderId) {

        Order order = findOrder(orderId);

        Instant now = timeProvider.now();

        order.markNotCollected(now);

        Order savedOrder =
                orderRepository.save(order);

        return loadOrderItems(savedOrder);
    }

    @Override
    @Transactional
    public Order cancelOrder(UUID orderId) {

        Order order = findOrder(orderId);

        Instant now = timeProvider.now();

        order.cancel(now);

        Order savedOrder =
                orderRepository.save(order);

        return loadOrderItems(savedOrder);
    }

    @Override
    @Transactional(readOnly = true)
    public List<Order> getOrdersByCafeteria(
            UUID cafeteriaId
    ) {

        List<Order> orders =
                orderRepository.findByCafeteriaId(
                        cafeteriaId
                );

        if (orders.isEmpty()) {
            return orders;
        }

        List<UUID> orderIds =
                orders.stream()
                        .map(Order::getId)
                        .toList();

        List<OrderItem> items =
                orderItemRepository.findByOrderIds(
                        orderIds
                );

        Map<UUID, List<OrderItem>> itemsByOrderId =
                items.stream()
                        .collect(
                                Collectors.groupingBy(
                                        OrderItem::getOrderId
                                )
                        );

        orders.forEach(order ->
                order.setItems(
                        itemsByOrderId.getOrDefault(
                                order.getId(),
                                List.of()
                        )
                )
        );

        return orders;
    }

    private Order loadOrderItems(Order order) {

        List<OrderItem> items =
                orderItemRepository.findByOrderId(
                        order.getId()
                );

        order.setItems(items);

        return order;
    }

    private Order findOrder(UUID orderId) {

        return orderRepository
                .findById(orderId)
                .orElseThrow(() ->
                        new OrderNotFoundException(orderId)
                );
    }
}
package com.santotofood.adapter.in.web.mapper;

import com.santotofood.adapter.in.web.dto.OrderItemResponse;
import com.santotofood.adapter.in.web.dto.OrderResponse;
import com.santotofood.domain.model.Order;
import com.santotofood.domain.model.OrderItem;
import org.springframework.stereotype.Component;

@Component
public class OrderResponseMapper {

    public OrderResponse toResponse(Order order) {

        return new OrderResponse(
                order.getId(),
                order.getCafeteriaId(),
                order.getClientId(),
                order.getClientName(),
                order.getClientDocument(),
                order.getStatus(),
                order.getTotal(),
                order.getCancellationDeadline(),
                order.getCreatedAt(),
                order.getUpdatedAt(),
                order.getItems()
                        .stream()
                        .map(this::toItemResponse)
                        .toList()
        );
    }

    private OrderItemResponse toItemResponse(
            OrderItem item
    ) {

        return new OrderItemResponse(
                item.getId(),
                item.getOrderId(),
                item.getLunchId(),
                item.getLunchName(),
                item.getUnitPrice(),
                item.getQuantity(),
                item.getBeverageChoice(),
                item.getNote(),
                item.getSubtotal()
        );
    }
}

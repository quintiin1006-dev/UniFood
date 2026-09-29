package com.santotofood.adapter.out.persistence.mapper;

import com.santotofood.adapter.out.persistence.entity.OrderItemEntity;
import com.santotofood.domain.model.OrderItem;
import org.springframework.stereotype.Component;

@Component
public class OrderItemMapper {

    public OrderItemEntity toEntity(OrderItem item) {
        return new OrderItemEntity(
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

    public OrderItem toDomain(OrderItemEntity entity) {
        return OrderItem.reconstitute(
                entity.getId(),
                entity.getOrderId(),
                entity.getLunchId(),
                entity.getLunchName(),
                entity.getUnitPrice(),
                entity.getQuantity(),
                entity.getBeverageChoice(),
                entity.getNote(),
                entity.getSubtotal()
        );
    }
}
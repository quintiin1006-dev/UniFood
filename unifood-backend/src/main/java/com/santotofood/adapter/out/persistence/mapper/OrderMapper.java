package com.santotofood.adapter.out.persistence.mapper;

import com.santotofood.adapter.out.persistence.entity.OrderEntity;
import com.santotofood.domain.model.Order;
import org.springframework.stereotype.Component;

@Component
public class OrderMapper {

    public OrderEntity toEntity(Order order) {

        return new OrderEntity(
                order.getId(),
                order.getCafeteriaId(),
                order.getClientId(),
                order.getClientName(),
                order.getClientDocument(),
                order.getStatus(),
                order.getTotal(),
                order.getCancellationDeadline(),
                order.getCalledAt(),
                order.getReminderCount(),
                order.getLastRemindedAt(),
                order.getDeliveredAt(),
                order.getNotCollectedAt(),
                order.getCreatedAt(),
                order.getUpdatedAt()
        );
    }

    public Order toDomain(OrderEntity entity) {

        return Order.reconstitute(
                entity.getId(),
                entity.getCafeteriaId(),
                entity.getClientId(),
                entity.getClientName(),
                entity.getClientDocument(),
                entity.getStatus(),
                entity.getTotal(),
                entity.getCancellationDeadline(),
                entity.getCalledAt(),
                entity.getReminderCount(),
                entity.getLastRemindedAt(),
                entity.getDeliveredAt(),
                entity.getNotCollectedAt(),
                entity.getCreatedAt(),
                entity.getUpdatedAt()
        );
    }
}
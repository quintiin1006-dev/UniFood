package com.santotofood.adapter.out.persistence.mapper;

import com.santotofood.adapter.out.persistence.entity.OrderEntity;
import com.santotofood.domain.model.Order;
import org.springframework.stereotype.Component;

@Component
public class OrderMapper {

  public OrderEntity toEntity(Order order) {

    OrderEntity entity =
        new OrderEntity(
            order.getId(),
            order.getCafeteriaId(),
            order.getClientId(),
            order.getClientName(),
            order.getStatus(),
            order.getTotal(),
            order.getCalledAt(),
            order.getReminderCount(),
            order.getLastRemindedAt(),
            order.getDeliveredAt(),
            order.getNotCollectedAt(),
            order.getCancelledAt(),
            order.getCreatedAt(),
            order.getUpdatedAt());
    entity.setVersion(order.getRevision());
    entity.setCancelledByClient(order.isCancelledByClient());
    entity.setCancellation(
        order.getCancellationSource(), order.getRejectionReason(), order.getRejectedBy());
    // A merge copies every attribute into the managed entity: without it the response would lose
    // the pickup time, although the read-only column itself is never written.
    entity.setRequestedPickupAt(order.getRequestedPickupAt());
    entity.setNote(order.getNote());
    return entity;
  }

  public Order toDomain(OrderEntity entity) {

    Order order =
        Order.reconstitute(
            entity.getId(),
            entity.getCafeteriaId(),
            entity.getClientId(),
            entity.getClientName(),
            entity.getClientCode(),
            entity.getClientType(),
            entity.getStatus(),
            entity.getTotal(),
            entity.getCalledAt(),
            entity.getReminderCount(),
            entity.getLastRemindedAt(),
            entity.getDeliveredAt(),
            entity.getNotCollectedAt(),
            entity.getCancelledAt(),
            entity.getCreatedAt(),
            entity.getUpdatedAt());
    order.restoreConcurrencyState(entity.getVersion(), entity.isCancelledByClient());
    order.restoreCancellation(
        entity.getCancellationSource(), entity.getRejectionReason(), entity.getRejectedBy());
    order.restoreRequestedPickupAt(entity.getRequestedPickupAt());
    order.restoreNote(entity.getNote());
    return order;
  }
}

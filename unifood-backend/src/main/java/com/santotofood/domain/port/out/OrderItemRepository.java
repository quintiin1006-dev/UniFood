package com.santotofood.domain.port.out;

import com.santotofood.domain.model.OrderItem;

import java.util.Collection;
import java.util.List;
import java.util.UUID;

public interface OrderItemRepository {

    OrderItem save(OrderItem orderItem);

    List<OrderItem> findByOrderId(UUID orderId);

    List<OrderItem> findByOrderIds(Collection<UUID> orderIds);
}
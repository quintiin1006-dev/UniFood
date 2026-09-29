package com.santotofood.domain.port.out;

import com.santotofood.domain.model.Order;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface OrderRepository {

    Order save(Order order);

    Optional<Order> findById(UUID orderId);

    List<Order> findByCafeteriaId(UUID cafeteriaId);

    Optional<Order> findFirstPendingByCafeteriaId(UUID cafeteriaId);
}
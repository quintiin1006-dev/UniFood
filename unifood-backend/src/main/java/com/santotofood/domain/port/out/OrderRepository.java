package com.santotofood.domain.port.out;

import com.santotofood.domain.model.Order;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface OrderRepository {

  Order save(Order order);

  Optional<Order> findById(UUID orderId);

  Optional<UUID> findCafeteriaId(UUID orderId);

  /** Authoritative mutation read; held until transaction completion. */
  Optional<Order> findByIdForUpdate(UUID orderId);

  /** Serialize preparation decisions for one cafeteria, including FIFO checks. */
  void lockCafeteriaQueue(UUID cafeteriaId);

  List<Order> findByCafeteriaId(UUID cafeteriaId);

  Optional<Order> findFirstPendingByCafeteriaId(UUID cafeteriaId);
}

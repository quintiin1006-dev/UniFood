package com.santotofood.domain.port.out;

import com.santotofood.domain.model.Order;
import java.time.Instant;
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

  List<Order> findOperational(UUID cafeteriaId, Instant start, Instant end);

  /**
   * The head of the FIFO queue: the oldest PENDING order of the cafeteria created within the
   * business day [dayStart, nextDayStart) in America/Bogota (§6). An older PENDING order never
   * blocks today's queue; the daily close cancels it.
   */
  Optional<Order> findFirstPendingByCafeteriaId(
      UUID cafeteriaId, Instant dayStart, Instant nextDayStart);
}

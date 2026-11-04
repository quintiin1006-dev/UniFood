package com.santotofood.application.port.in;

import com.santotofood.domain.model.Order;
import java.util.List;
import java.util.UUID;

public interface CreateOwnOrderUseCase {

  /**
   * Creates a PENDING order for the client profile owned by {@code userId}. Prices and the
   * cafeteria come from the database; the caller only chooses lunches, quantities and notes.
   */
  Order createOwnOrder(UUID userId, List<OrderLine> lines);

  record OrderLine(UUID lunchId, int quantity, String note) {}
}

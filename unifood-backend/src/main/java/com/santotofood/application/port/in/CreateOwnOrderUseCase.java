package com.santotofood.application.port.in;

import com.santotofood.application.model.ClientOrder;
import java.util.List;
import java.util.UUID;

/** B15: a CLIENT creates their own order (docs/decisiones.md §6 and §11). */
public interface CreateOwnOrderUseCase {

  /**
   * Creates a PENDING order for the client behind {@code userId}, or returns the one this {@code
   * idempotencyKey} already created. Prices, totals and availability come from the database; {@code
   * request} only names products and quantities, and is {@code null} when the body could not be
   * read.
   */
  CreatedOrder createOwnOrder(UUID userId, String idempotencyKey, OrderRequest request);

  record OrderRequest(UUID cafeteriaId, List<Line> items, String note) {}

  record Line(UUID productId, int quantity) {}

  /** {@code created} is false when the same request was already served under that key. */
  record CreatedOrder(ClientOrder order, boolean created) {}
}

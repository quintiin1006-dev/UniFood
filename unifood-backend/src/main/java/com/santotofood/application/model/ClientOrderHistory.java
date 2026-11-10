package com.santotofood.application.model;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** One page of the client's own orders, newest first; {@code nextCursor} is null on the last. */
public record ClientOrderHistory(List<Entry> orders, String nextCursor) {

  public ClientOrderHistory {
    orders = List.copyOf(orders);
  }

  public record Entry(
      UUID id,
      String status,
      BigDecimal total,
      Instant createdAt,
      String cafeteriaName,
      int itemCount,
      String summary) {}
}

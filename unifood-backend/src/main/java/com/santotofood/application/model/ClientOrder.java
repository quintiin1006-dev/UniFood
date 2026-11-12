package com.santotofood.application.model;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * An order as its client sees it (docs/decisiones.md §11): never the client's document. {@code
 * requestedPickupAt} is null for "as soon as possible".
 */
public record ClientOrder(
    UUID id,
    String status,
    BigDecimal total,
    String note,
    Instant createdAt,
    List<Item> items,
    Cafeteria cafeteria,
    String cancellationSource,
    String rejectionReason,
    Timeline timeline,
    Instant requestedPickupAt) {

  public ClientOrder {
    items = List.copyOf(items);
  }

  public record Item(String name, int quantity, BigDecimal unitPrice, BigDecimal subtotal) {}

  public record Cafeteria(UUID id, String name) {}

  /** The order's own marks; {@code orders} has no separate preparing or ready time. */
  public record Timeline(
      Instant updatedAt,
      Instant calledAt,
      int reminderCount,
      Instant lastRemindedAt,
      Instant deliveredAt,
      Instant notCollectedAt,
      Instant cancelledAt) {}
}

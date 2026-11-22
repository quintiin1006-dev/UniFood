package com.santotofood.application.model;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * An order as its client sees it (docs/decisiones.md §11): never the client's document. {@code
 * requestedPickupAt} is null for "as soon as possible"; {@code dailyMenu} is null for an order
 * without the daily menu.
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
    Instant requestedPickupAt,
    OrderDailyMenu dailyMenu) {

  public ClientOrder {
    items = List.copyOf(items);
  }

  /** An order without the daily menu. */
  public ClientOrder(
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
    this(
        id,
        status,
        total,
        note,
        createdAt,
        items,
        cafeteria,
        cancellationSource,
        rejectionReason,
        timeline,
        requestedPickupAt,
        null);
  }

  /** The same order with its daily menu copy, or null when it has none. */
  public ClientOrder withDailyMenu(OrderDailyMenu menu) {
    return new ClientOrder(
        id,
        status,
        total,
        note,
        createdAt,
        items,
        cafeteria,
        cancellationSource,
        rejectionReason,
        timeline,
        requestedPickupAt,
        menu);
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

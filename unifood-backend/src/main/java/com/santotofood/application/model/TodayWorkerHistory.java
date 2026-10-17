package com.santotofood.application.model;

import com.santotofood.domain.model.BusinessDate;
import com.santotofood.domain.model.OrderStatus;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Objects;
import java.util.UUID;

/** Minimal read projection; customer and item names come from stored order snapshots. */
public record TodayWorkerHistory(
    BusinessDate businessDate, Instant nextBusinessDateAt, List<Entry> orders) {
  public TodayWorkerHistory {
    Objects.requireNonNull(businessDate);
    Objects.requireNonNull(nextBusinessDateAt);
    orders = List.copyOf(orders);
  }

  public record Entry(
      UUID id,
      String clientName,
      OrderStatus status,
      Instant completedAt,
      BigDecimal total,
      List<Item> items) {
    public Entry {
      Objects.requireNonNull(id);
      // Preserve older orders without a usable name; never invent a customer identity.
      if (clientName != null && clientName.isBlank()) clientName = null;
      Objects.requireNonNull(status);
      Objects.requireNonNull(completedAt);
      requireAmount(total);
      if (status != OrderStatus.DELIVERED
          && status != OrderStatus.NOT_COLLECTED
          && status != OrderStatus.CANCELLED)
        throw new IllegalArgumentException("Invalid worker history state");
      items = List.copyOf(items);
    }
  }

  public record Item(String name, int quantity, BigDecimal unitPrice, BigDecimal subtotal) {
    public Item {
      Objects.requireNonNull(name);
      requireAmount(unitPrice);
      requireAmount(subtotal);
      if (quantity <= 0) throw new IllegalArgumentException("Invalid worker history quantity");
    }
  }

  private static void requireAmount(BigDecimal value) {
    if (Objects.requireNonNull(value).signum() < 0)
      throw new IllegalArgumentException("Invalid worker history amount");
  }
}

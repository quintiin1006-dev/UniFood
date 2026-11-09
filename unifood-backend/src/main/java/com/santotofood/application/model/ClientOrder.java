package com.santotofood.application.model;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** An order as its client sees it (docs/decisiones.md §11): never the client's document. */
public record ClientOrder(
    UUID id, String status, BigDecimal total, String note, Instant createdAt, List<Item> items) {

  public ClientOrder {
    items = List.copyOf(items);
  }

  public record Item(String name, int quantity, BigDecimal unitPrice, BigDecimal subtotal) {}
}

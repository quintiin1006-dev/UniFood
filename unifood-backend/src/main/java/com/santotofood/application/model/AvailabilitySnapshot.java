package com.santotofood.application.model;

import com.santotofood.domain.model.CatalogCategory;
import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

/** One database snapshot of a cafeteria and its administratively active catalog. */
public record AvailabilitySnapshot(Cafeteria cafeteria, List<Item> items) {
  public record Cafeteria(UUID id, String name, boolean active, boolean open) {}

  public record Item(
      UUID id,
      String name,
      String description,
      BigDecimal price,
      String image,
      CatalogCategory category,
      boolean available) {}
}

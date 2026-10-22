package com.santotofood.application.model;

import com.santotofood.domain.model.CatalogCategory;
import java.math.BigDecimal;
import java.util.Objects;
import java.util.UUID;

/** Commercial catalog projection; deliberately contains no daily availability or stock. */
public record AdminCatalogProduct(
    UUID id,
    String name,
    String description,
    BigDecimal price,
    CatalogCategory category,
    String imageUrl,
    boolean active) {
  public AdminCatalogProduct {
    Objects.requireNonNull(id);
    Objects.requireNonNull(category);
    Objects.requireNonNull(price);
    if (name == null || name.isBlank() || price.signum() <= 0)
      throw new IllegalArgumentException("Invalid catalog projection");
  }
}

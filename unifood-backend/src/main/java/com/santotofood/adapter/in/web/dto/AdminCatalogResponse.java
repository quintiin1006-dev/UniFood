package com.santotofood.adapter.in.web.dto;

import com.santotofood.application.model.AdminCatalogProduct;
import com.santotofood.domain.model.CatalogCategory;
import java.util.List;
import java.util.UUID;

public record AdminCatalogResponse(List<Product> products) {
  /** Decimal string preserves the exact PostgreSQL NUMERIC value across JSON/JavaScript. */
  public record Product(
      UUID id,
      String name,
      String description,
      String price,
      CatalogCategory category,
      String imageUrl,
      boolean active,
      String version) {}

  public static Product product(AdminCatalogProduct p) {
    return new Product(
        p.id(),
        p.name(),
        p.description(),
        p.price().toPlainString(),
        p.category(),
        p.imageUrl(),
        p.active(),
        Long.toString(p.version()));
  }

  public static AdminCatalogResponse from(List<AdminCatalogProduct> products) {
    return new AdminCatalogResponse(
        products.stream()
            .map(
                p ->
                    new Product(
                        p.id(),
                        p.name(),
                        p.description(),
                        p.price().toPlainString(),
                        p.category(),
                        p.imageUrl(),
                        p.active(),
                        Long.toString(p.version())))
            .toList());
  }
}

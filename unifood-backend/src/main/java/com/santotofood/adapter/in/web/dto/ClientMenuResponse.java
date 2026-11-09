package com.santotofood.adapter.in.web.dto;

import com.santotofood.application.model.ClientMenu;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/** docs/decisiones.md §11 menu. Prices travel as decimal strings, as in the contract. */
public record ClientMenuResponse(
    Cafeteria cafeteria, LocalDate businessDate, List<Category> categories) {

  public record Cafeteria(UUID id, String name, boolean open) {}

  public record Category(String id, List<Product> products) {}

  public record Product(
      UUID id, String name, String description, String price, String imageUrl, boolean available) {}

  public static ClientMenuResponse from(ClientMenu menu) {
    return new ClientMenuResponse(
        new Cafeteria(menu.cafeteria().id(), menu.cafeteria().name(), menu.cafeteria().open()),
        menu.businessDate(),
        menu.categories().stream()
            .map(
                category ->
                    new Category(
                        category.id(),
                        category.products().stream()
                            .map(
                                product ->
                                    new Product(
                                        product.id(),
                                        product.name(),
                                        product.description(),
                                        product
                                            .price()
                                            .setScale(2, RoundingMode.UNNECESSARY)
                                            .toPlainString(),
                                        // Client images arrive with the screens PR.
                                        null,
                                        product.available()))
                            .toList()))
            .toList());
  }
}

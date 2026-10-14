package com.santotofood.adapter.in.web.dto;

import com.santotofood.application.model.TodayAvailability;
import com.santotofood.domain.model.CatalogCategory;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

public record TodayAvailabilityResponse(
    LocalDate businessDate, Cafeteria cafeteria, List<Category> categories) {
  public record Cafeteria(UUID id, String name, boolean active, boolean open) {}

  public record Category(CatalogCategory category, List<Item> items) {}

  public record Item(
      UUID id,
      String name,
      String description,
      BigDecimal price,
      String image,
      boolean available) {}

  public static TodayAvailabilityResponse from(TodayAvailability today) {
    var cafe = today.cafeteria();
    return new TodayAvailabilityResponse(
        today.businessDate().value(),
        new Cafeteria(cafe.id(), cafe.name(), cafe.active(), cafe.open()),
        today.categories().stream()
            .map(
                group ->
                    new Category(
                        group.category(),
                        group.items().stream()
                            .map(
                                item ->
                                    new Item(
                                        item.id(),
                                        item.name(),
                                        item.description(),
                                        item.price(),
                                        item.image(),
                                        item.available()))
                            .toList()))
            .toList());
  }
}

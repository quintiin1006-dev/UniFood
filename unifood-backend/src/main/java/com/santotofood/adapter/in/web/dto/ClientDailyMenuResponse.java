package com.santotofood.adapter.in.web.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.santotofood.application.model.ClientDailyMenu;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * docs/propuesta-menu-dinamico.md section 3.2. Prices travel as decimal strings, as in the catalog.
 * Only published, client-facing fields: no version, publisher or worker ids.
 */
public record ClientDailyMenuResponse(
    Cafeteria cafeteria,
    LocalDate businessDate,
    String title,
    String price,
    List<Category> categories) {

  public record Cafeteria(UUID id, String name, boolean open) {}

  /** SINGLE categories carry {@code options}; the ADDITIONS one carries {@code additions}. */
  @JsonInclude(JsonInclude.Include.NON_NULL)
  public record Category(
      UUID id,
      String label,
      String kind,
      boolean canSkip,
      List<Option> options,
      List<Addition> additions) {}

  public record Option(UUID id, String label) {}

  public record Addition(UUID id, String name, String extraPrice) {}

  public static ClientDailyMenuResponse from(ClientDailyMenu menu) {
    return new ClientDailyMenuResponse(
        new Cafeteria(menu.cafeteria().id(), menu.cafeteria().name(), menu.cafeteria().open()),
        menu.businessDate(),
        menu.title(),
        money(menu.price()),
        menu.categories().stream()
            .map(
                category ->
                    new Category(
                        category.id(),
                        category.label(),
                        category.kind(),
                        category.canSkip(),
                        category.options() == null
                            ? null
                            : category.options().stream()
                                .map(option -> new Option(option.id(), option.label()))
                                .toList(),
                        category.additions() == null
                            ? null
                            : category.additions().stream()
                                .map(
                                    addition ->
                                        new Addition(
                                            addition.id(),
                                            addition.name(),
                                            money(addition.extraPrice())))
                                .toList()))
            .toList());
  }

  private static String money(BigDecimal value) {
    return value.setScale(2, RoundingMode.UNNECESSARY).toPlainString();
  }
}

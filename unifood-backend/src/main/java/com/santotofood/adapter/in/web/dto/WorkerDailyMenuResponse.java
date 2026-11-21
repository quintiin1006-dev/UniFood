package com.santotofood.adapter.in.web.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.santotofood.application.model.WorkerDailyMenu;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * docs/propuesta-menu-dinamico.md section 3.2, worker side. Prices travel as decimal strings, as in
 * the client contract; {@code price} is null without a configured plate price. {@code
 * skippedCategories} is present only in the answer of «Copiar el de ayer».
 */
public record WorkerDailyMenuResponse(
    LocalDate businessDate,
    long version,
    boolean published,
    boolean complete,
    List<String> missingCategories,
    boolean priceSet,
    String title,
    String price,
    List<Category> categories,
    List<Addition> additions,
    @JsonInclude(JsonInclude.Include.NON_NULL) List<String> skippedCategories) {

  public record Category(
      UUID id, String label, String kind, boolean canSkip, List<Option> options, int textUsed) {}

  public record Option(UUID id, String label) {}

  public record Addition(UUID id, String name, String extraPrice, boolean available) {}

  public static WorkerDailyMenuResponse from(WorkerDailyMenu menu) {
    return new WorkerDailyMenuResponse(
        menu.businessDate(),
        menu.version(),
        menu.published(),
        menu.complete(),
        menu.missingCategories(),
        menu.priceSet(),
        menu.title(),
        money(menu.price()),
        menu.categories().stream()
            .map(
                category ->
                    new Category(
                        category.id(),
                        category.label(),
                        "SINGLE",
                        category.canSkip(),
                        category.options().stream()
                            .map(option -> new Option(option.id(), option.label()))
                            .toList(),
                        category.textUsed()))
            .toList(),
        menu.additions().stream()
            .map(
                addition ->
                    new Addition(
                        addition.id(),
                        addition.name(),
                        money(addition.extraPrice()),
                        addition.available()))
            .toList(),
        menu.skippedCategories());
  }

  private static String money(BigDecimal value) {
    return value == null ? null : value.setScale(2, RoundingMode.UNNECESSARY).toPlainString();
  }
}

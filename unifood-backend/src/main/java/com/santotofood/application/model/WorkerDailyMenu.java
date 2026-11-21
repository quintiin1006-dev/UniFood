package com.santotofood.application.model;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * Today's daily menu as the worker edits it (docs/propuesta-menu-dinamico.md, section 3.2). Title
 * and price are the frozen copy while published and the current settings otherwise; {@code price}
 * is null when no plate price is configured.
 */
public record WorkerDailyMenu(
    LocalDate businessDate,
    long version,
    boolean published,
    boolean complete,
    List<String> missingCategories,
    boolean priceSet,
    String title,
    BigDecimal price,
    List<Category> categories,
    List<Addition> additions,
    List<String> skippedCategories) {

  /** Active SINGLE categories; {@code textUsed} is the characters used of 350. */
  public record Category(
      UUID id, String label, boolean canSkip, List<Option> options, int textUsed) {}

  public record Option(UUID id, String label) {}

  public record Addition(UUID id, String name, BigDecimal extraPrice, boolean available) {}

  /** The same state, reporting the categories «Copiar el de ayer» left untouched. */
  public WorkerDailyMenu withSkipped(List<String> skipped) {
    return new WorkerDailyMenu(
        businessDate,
        version,
        published,
        complete,
        missingCategories,
        priceSet,
        title,
        price,
        categories,
        additions,
        List.copyOf(skipped));
  }
}

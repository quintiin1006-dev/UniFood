package com.santotofood.application.model;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * Today's published daily menu for a client (docs/propuesta-menu-dinamico.md, section 3.2). A
 * closed cafeteria still shows it, with {@code open = false}.
 */
public record ClientDailyMenu(
    ClientMenu.Cafeteria cafeteria,
    LocalDate businessDate,
    String title,
    BigDecimal price,
    List<Category> categories) {

  /** SINGLE categories carry options; the ADDITIONS one carries additions. The other is null. */
  public record Category(
      UUID id,
      String label,
      String kind,
      boolean canSkip,
      List<Option> options,
      List<Addition> additions) {}

  public record Option(UUID id, String label) {}

  public record Addition(UUID id, String name, BigDecimal extraPrice) {}
}

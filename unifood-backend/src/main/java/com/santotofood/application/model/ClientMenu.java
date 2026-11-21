package com.santotofood.application.model;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * Today's menu. A closed cafeteria still lists its active products, each unavailable, so the client
 * can browse without ordering (docs/decisiones.md §6). {@code dailyMenu} is null while
 * MENU_DINAMICO_ENABLED is off (docs/propuesta-menu-dinamico.md, section 3.1).
 */
public record ClientMenu(
    Cafeteria cafeteria, LocalDate businessDate, List<Category> categories, DailyMenu dailyMenu) {

  public record Cafeteria(UUID id, String name, boolean open) {}

  public record Category(String id, List<Product> products) {}

  public record Product(
      UUID id, String name, String description, BigDecimal price, boolean available) {}

  /** Whether today's daily menu of the cafeteria is published and complete. */
  public record DailyMenu(boolean available) {}
}

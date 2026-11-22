package com.santotofood.application.model;

import java.math.BigDecimal;
import java.util.List;

/**
 * The daily menu copied into an order (docs/propuesta-menu-dinamico.md, sections 2.3 and 3.5): what
 * is shown and what was charged, whatever the worker changes later.
 */
public record OrderDailyMenu(String title, BigDecimal price, List<Choice> choices) {

  public OrderDailyMenu {
    choices = List.copyOf(choices);
  }

  /** {@code kind} is OPTION, NONE («Ninguna», label null) or ADDITION (with its extra price). */
  public record Choice(String category, String kind, String label, BigDecimal extraPrice) {}
}

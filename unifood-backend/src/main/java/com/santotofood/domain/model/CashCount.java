package com.santotofood.domain.model;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * A count by denomination: Colombian bills 50.000 to 2.000 and coins 1.000 to 50. The total is
 * computed here, never accepted from the client.
 */
public final class CashCount {
  public static final List<Integer> DENOMINATIONS =
      List.of(50000, 20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50);
  public static final int MAX_QUANTITY = 10000;

  private final Map<Integer, Integer> quantities;

  private CashCount(Map<Integer, Integer> quantities) {
    this.quantities = Collections.unmodifiableMap(quantities);
  }

  /** Every denomination valid, none repeated, quantities 0 to 10.000; missing ones count as 0. */
  public static CashCount of(Map<Integer, Integer> lines) {
    var ordered = new LinkedHashMap<Integer, Integer>();
    for (int denomination : DENOMINATIONS) ordered.put(denomination, 0);
    for (var line : lines.entrySet()) {
      Integer denomination = line.getKey(), quantity = line.getValue();
      if (denomination == null || !DENOMINATIONS.contains(denomination))
        throw new IllegalArgumentException("Unknown denomination");
      if (quantity == null || quantity < 0 || quantity > MAX_QUANTITY)
        throw new IllegalArgumentException("Quantity out of range");
      ordered.put(denomination, quantity);
    }
    return new CashCount(ordered);
  }

  /** Denomination to quantity, highest first, including zeros. */
  public Map<Integer, Integer> quantities() {
    return quantities;
  }

  public long total() {
    long total = 0;
    for (var line : quantities.entrySet())
      total = Math.addExact(total, Math.multiplyExact((long) line.getKey(), line.getValue()));
    return total;
  }
}

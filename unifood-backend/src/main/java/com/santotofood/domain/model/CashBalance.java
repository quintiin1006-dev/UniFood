package com.santotofood.domain.model;

/**
 * Cash register arithmetic in whole COP (docs/decisiones.md §14). Every operation is exact: an
 * overflow throws instead of wrapping, and no floating point is involved.
 *
 * <p>Expected = opening float + delivered sales + other income - expenses. Difference = counted -
 * expected: positive is a surplus, negative a shortage.
 */
public record CashBalance(long openingFloat, long sales, long income, long expense) {
  public enum Outcome {
    BALANCED,
    SURPLUS,
    SHORTAGE
  }

  public CashBalance {
    if (openingFloat < 0 || sales < 0 || income < 0 || expense < 0)
      throw new IllegalArgumentException("Cash amounts are never negative");
  }

  public long expected() {
    return Math.subtractExact(Math.addExact(Math.addExact(openingFloat, sales), income), expense);
  }

  /** Cash that would remain after an expense: it can never take the drawer below zero. */
  public boolean allowsExpense(long amount) {
    return amount > 0 && amount <= expected();
  }

  public long difference(long counted) {
    if (counted < 0) throw new IllegalArgumentException("Counted cash is never negative");
    return Math.subtractExact(counted, expected());
  }

  public static Outcome outcome(long difference) {
    if (difference == 0) return Outcome.BALANCED;
    return difference > 0 ? Outcome.SURPLUS : Outcome.SHORTAGE;
  }

  /** The tolerance is inclusive: a difference equal to it is still within. */
  public static boolean withinTolerance(long difference, long tolerance) {
    if (tolerance < 0) throw new IllegalArgumentException("Tolerance is never negative");
    return Math.absExact(difference) <= tolerance;
  }
}

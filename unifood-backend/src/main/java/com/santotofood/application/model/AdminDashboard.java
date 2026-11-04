package com.santotofood.application.model;

import java.math.BigDecimal;
import java.math.BigInteger;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

public record AdminDashboard(
    AdminDashboardPeriod period,
    Summary summary,
    List<Trend> trend,
    Ranking topDeliveredProducts,
    Ranking notCollectedProducts,
    Coverage coverage) {
  public AdminDashboard {
    trend = List.copyOf(trend);
  }

  public static BigDecimal percentage(BigInteger units, BigInteger total) {
    return total.signum() == 0
        ? null
        : new BigDecimal(units)
            .multiply(new BigDecimal("100"))
            .divide(new BigDecimal(total), 2, java.math.RoundingMode.HALF_UP);
  }

  public record Summary(
      BigInteger receivedOrders,
      BigInteger deliveredOrders,
      BigInteger notCollectedOrders,
      BigInteger notCollectedUnits,
      BigDecimal receivedOrderValue,
      BigDecimal deliveredOrderValue,
      BigDecimal notCollectedOrderValue,
      BigDecimal notCollectedItemValue,
      BigDecimal notCollectedRatePercent,
      BigInteger notCollectedRateDenominator) {}

  public record Trend(
      LocalDate date,
      BigInteger receivedOrders,
      BigInteger deliveredOrders,
      BigInteger notCollectedOrders) {}

  public record Totals(
      BigInteger products, BigInteger orders, BigInteger units, BigDecimal itemValue) {}

  public record Omitted(BigInteger products, BigInteger units, BigDecimal itemValue) {}

  public record Product(
      UUID productId,
      String historicalName,
      BigInteger units,
      BigInteger orders,
      BigDecimal itemValue,
      BigDecimal unitSharePercent) {}

  public record Ranking(
      String availability,
      int limit,
      boolean hasMore,
      Totals totals,
      Omitted omitted,
      List<Product> items) {
    public Ranking {
      items = List.copyOf(items);
    }

    public static Ranking unavailable(int limit) {
      return new Ranking(
          "UNAVAILABLE_INCOMPLETE_ITEMS",
          limit,
          false,
          new Totals(null, null, null, null),
          new Omitted(null, null, null),
          List.of());
    }
  }

  public record Scope(
      String basis, List<String> eventTypes, Instant startInclusive, Instant endExclusive) {
    public Scope {
      eventTypes = List.copyOf(eventTypes);
    }
  }

  public record Check(
      String code,
      String status,
      Scope scope,
      BigInteger examinedOrders,
      BigInteger affectedOrders,
      Instant assessedAt) {}

  public record Warning(String code, List<String> affects) {
    public Warning {
      affects = List.copyOf(affects);
    }
  }

  public record Provenance(String status, BigInteger verifiedRealOrders) {}

  public record Coverage(
      String assessment,
      Instant assessedAt,
      List<Check> checks,
      Provenance provenance,
      List<Warning> warnings) {
    public Coverage {
      checks = List.copyOf(checks);
      warnings = List.copyOf(warnings);
    }
  }
}

package com.santotofood.adapter.in.web.dto;

import com.santotofood.application.model.AdminDashboard;
import com.santotofood.application.model.AdminDashboardPeriod;
import java.math.BigDecimal;
import java.math.BigInteger;
import java.math.RoundingMode;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/** Explicit projection: no tenant selector, order IDs or student data cross this boundary. */
public record AdminDashboardResponse(
    AdminDashboardPeriod period,
    String basis,
    String currency,
    Summary summary,
    List<Trend> trend,
    Ranking topDeliveredProducts,
    Ranking notCollectedProducts,
    Coverage coverage) {
  public record Summary(
      String receivedOrders,
      String deliveredOrders,
      String notCollectedOrders,
      String notCollectedUnits,
      String receivedOrderValue,
      String deliveredOrderValue,
      String notCollectedOrderValue,
      String notCollectedItemValue,
      String notCollectedRatePercent,
      String notCollectedRateDenominator) {}

  public record Trend(
      LocalDate date, String receivedOrders, String deliveredOrders, String notCollectedOrders) {}

  public record Totals(String products, String orders, String units, String itemValue) {}

  public record Omitted(String products, String units, String itemValue) {}

  public record Product(
      UUID productId,
      String historicalName,
      String units,
      String orders,
      String itemValue,
      String unitSharePercent) {}

  public record Ranking(
      String availability,
      int limit,
      boolean hasMore,
      Totals totals,
      Omitted omitted,
      List<Product> items) {}

  public record Check(
      String code,
      String status,
      AdminDashboard.Scope scope,
      String examinedOrders,
      String affectedOrders,
      Instant assessedAt) {}

  public record Provenance(String status, String verifiedRealOrders) {}

  public record Coverage(
      String assessment,
      Instant assessedAt,
      List<Check> checks,
      Provenance provenance,
      List<AdminDashboard.Warning> warnings) {}

  public static AdminDashboardResponse from(AdminDashboard dashboard) {
    var s = dashboard.summary();
    var c = dashboard.coverage();
    return new AdminDashboardResponse(
        dashboard.period(),
        "EVENT_DATE",
        "COP",
        new Summary(
            integer(s.receivedOrders()),
            integer(s.deliveredOrders()),
            integer(s.notCollectedOrders()),
            integer(s.notCollectedUnits()),
            decimal(s.receivedOrderValue()),
            decimal(s.deliveredOrderValue()),
            decimal(s.notCollectedOrderValue()),
            decimal(s.notCollectedItemValue()),
            decimal(s.notCollectedRatePercent()),
            integer(s.notCollectedRateDenominator())),
        dashboard.trend().stream()
            .map(
                t ->
                    new Trend(
                        t.date(),
                        integer(t.receivedOrders()),
                        integer(t.deliveredOrders()),
                        integer(t.notCollectedOrders())))
            .toList(),
        ranking(dashboard.topDeliveredProducts()),
        ranking(dashboard.notCollectedProducts()),
        new Coverage(
            c.assessment(),
            c.assessedAt(),
            c.checks().stream()
                .map(
                    check ->
                        new Check(
                            check.code(),
                            check.status(),
                            check.scope(),
                            integer(check.examinedOrders()),
                            integer(check.affectedOrders()),
                            check.assessedAt()))
                .toList(),
            new Provenance(c.provenance().status(), integer(c.provenance().verifiedRealOrders())),
            c.warnings()));
  }

  private static Ranking ranking(AdminDashboard.Ranking r) {
    return new Ranking(
        r.availability(),
        r.limit(),
        r.hasMore(),
        new Totals(
            integer(r.totals().products()),
            integer(r.totals().orders()),
            integer(r.totals().units()),
            decimal(r.totals().itemValue())),
        new Omitted(
            integer(r.omitted().products()),
            integer(r.omitted().units()),
            decimal(r.omitted().itemValue())),
        r.items().stream()
            .map(
                p ->
                    new Product(
                        p.productId(),
                        p.historicalName(),
                        integer(p.units()),
                        integer(p.orders()),
                        decimal(p.itemValue()),
                        decimal(p.unitSharePercent())))
            .toList());
  }

  private static String integer(BigInteger value) {
    return value == null ? null : value.toString();
  }

  private static String decimal(BigDecimal value) {
    return value == null ? null : value.setScale(2, RoundingMode.UNNECESSARY).toPlainString();
  }
}

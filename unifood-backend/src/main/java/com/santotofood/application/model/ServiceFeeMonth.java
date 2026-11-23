package com.santotofood.application.model;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.YearMonth;
import java.util.List;
import java.util.UUID;

/**
 * One month of the service fee for one or more cafeterias (docs/modelo-de-negocio.md, rules 6 to
 * 9). An open month is the live sum; a closed one is its frozen copy.
 */
public record ServiceFeeMonth(YearMonth month, boolean current, List<Row> rows) {

  public ServiceFeeMonth {
    rows = List.copyOf(rows);
  }

  /** ABIERTO: not closed yet (live). PENDIENTE and PAGADA: closed. */
  public enum Status {
    ABIERTO,
    PENDIENTE,
    PAGADA
  }

  /**
   * {@code feeTotal} is what the cafeteria transfers to UniFood; {@code productsTotal} its own
   * sales. {@code overdue} only for PENDIENTE past the grace days, with {@code daysOverdue}. {@code
   * closable}: an open month that has already ended.
   */
  public record Row(
      UUID cafeteriaId,
      String cafeteriaName,
      String siteName,
      YearMonth month,
      int deliveredOrders,
      BigDecimal productsTotal,
      long feeTotal,
      Status status,
      Instant closedAt,
      Instant paidAt,
      String note,
      boolean overdue,
      long daysOverdue,
      boolean closable) {}
}

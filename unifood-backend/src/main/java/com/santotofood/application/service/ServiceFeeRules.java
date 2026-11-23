package com.santotofood.application.service;

import java.time.LocalDate;
import java.time.YearMonth;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;

/** Fixed rules of the service fee (docs/modelo-de-negocio.md), shared by orders and settlements. */
public final class ServiceFeeRules {
  /** chk_service_fee_settings_fee, chk_cafeteria_service_fee_fee and chk_orders_service_fee. */
  public static final int MAX_FEE_COP = 2000;

  /** Rule 9: a closed month still PENDIENTE this many days after it ends is «Vencido». */
  public static final int SETTLEMENT_GRACE_DAYS = 10;

  /** The month of a fee is the month of delivered_at here (rule 8). */
  public static final ZoneId ZONE = ZoneId.of("America/Bogota");

  /** The first month any fee may exist in; earlier months are refused as invalid. */
  public static final YearMonth FIRST_MONTH = YearMonth.of(2026, 1);

  private ServiceFeeRules() {}

  public static boolean validFee(int fee) {
    return fee >= 0 && fee <= MAX_FEE_COP;
  }

  /** The day after which a PENDIENTE month is overdue. */
  public static LocalDate dueDate(YearMonth month) {
    return month.atEndOfMonth().plusDays(SETTLEMENT_GRACE_DAYS);
  }

  /** Days late for a PENDIENTE month; 0 while it is not overdue. */
  public static long daysOverdue(YearMonth month, LocalDate today) {
    var due = dueDate(month);
    return today.isAfter(due) ? ChronoUnit.DAYS.between(due, today) : 0;
  }
}

package com.santotofood.application.model;

import com.santotofood.application.exception.CafeteriaSettingsException;
import java.util.Objects;

/**
 * Billing agreement of one cafeteria (decisiones §5). Nothing is charged by the system: it only
 * records the agreement. Amounts are whole Colombian pesos, as in migration 022.
 */
public record CafeteriaBilling(Model model, Integer perOrderFeeCop, Integer subscriptionFeeCop) {
  public static final int MAX_PER_ORDER_FEE_COP = 1_000_000;
  public static final int MAX_SUBSCRIPTION_FEE_COP = 100_000_000;

  public enum Model {
    NONE,
    SUBSCRIPTION,
    PER_ORDER_FEE
  }

  /**
   * The per-order fee is mandatory with PER_ORDER_FEE and forbidden otherwise; the monthly amount
   * is optional and only SUBSCRIPTION may carry it.
   */
  public CafeteriaBilling {
    if (model == null) throw CafeteriaSettingsException.invalidBilling();
    if ((model == Model.PER_ORDER_FEE) != (perOrderFeeCop != null))
      throw CafeteriaSettingsException.invalidBilling();
    if (perOrderFeeCop != null && (perOrderFeeCop < 1 || perOrderFeeCop > MAX_PER_ORDER_FEE_COP))
      throw CafeteriaSettingsException.invalidBilling();
    if (subscriptionFeeCop != null
        && (model != Model.SUBSCRIPTION
            || subscriptionFeeCop < 1
            || subscriptionFeeCop > MAX_SUBSCRIPTION_FEE_COP))
      throw CafeteriaSettingsException.invalidBilling();
  }

  public static CafeteriaBilling none() {
    return new CafeteriaBilling(Model.NONE, null, null);
  }

  /** Rebuilds a stored agreement; the 022 CHECKs already guarantee it is valid. */
  public static CafeteriaBilling stored(
      String model, Integer perOrderFee, Integer subscriptionFee) {
    return new CafeteriaBilling(
        Model.valueOf(Objects.requireNonNull(model)), perOrderFee, subscriptionFee);
  }
}

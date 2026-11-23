package com.santotofood.application.model;

import java.util.List;
import java.util.UUID;

/**
 * The ADMIN's read-only view of their own cafeteria: the fee in force and the months, newest first.
 */
public record ServiceFeeStatement(
    UUID cafeteriaId, String cafeteriaName, int currentFeeCop, List<ServiceFeeMonth.Row> months) {

  public ServiceFeeStatement {
    months = List.copyOf(months);
  }
}

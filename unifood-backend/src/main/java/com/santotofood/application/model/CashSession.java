package com.santotofood.application.model;

import com.santotofood.domain.model.CashBalance;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

/**
 * One stored cash session (migration 028). The closing figures are null unless it is CLOSED. Names
 * are display names only, never an email or an id.
 */
public record CashSession(
    UUID id,
    UUID cafeteriaId,
    String cafeteriaName,
    Shift shift,
    LocalDate businessDate,
    int sequenceNumber,
    Status status,
    long openingFloat,
    Instant openedAt,
    String openedByName,
    Instant closedAt,
    String closedByName,
    Long salesCash,
    Long incomeTotal,
    Long expenseTotal,
    Long expectedCash,
    Long countedCash,
    Long difference,
    Integer toleranceCop,
    String note,
    Integer pendingOrdersAtClose,
    Boolean forcedClose,
    int reopenCount,
    Instant reopenedAt,
    String reopenedByName,
    String reopenReason,
    int version) {
  public enum Shift {
    BREAKFAST,
    LUNCH
  }

  public enum Status {
    OPEN,
    CLOSED,
    REOPENED
  }

  public boolean open() {
    return status != Status.CLOSED;
  }

  public CashBalance.Outcome outcome() {
    return difference == null ? null : CashBalance.outcome(difference);
  }

  /** Only a closed session has a verdict; the tolerance is the one in force when it closed. */
  public Boolean outsideTolerance() {
    if (difference == null || toleranceCop == null) return null;
    return !CashBalance.withinTolerance(difference, toleranceCop);
  }
}

package com.santotofood.application.model;

import com.santotofood.domain.model.CashBalance;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** Read models of the cash register module (docs/decisiones.md §14). */
public final class CashViews {
  private CashViews() {}

  /** Who operates a drawer: a WORKER or the ADMIN of exactly one cafeteria. */
  public record Operator(UUID userId, UUID cafeteriaId, boolean admin) {}

  public record Movement(
      UUID id, Kind kind, long amount, String reason, Instant createdAt, String createdByName) {
    public enum Kind {
      INCOME,
      EXPENSE
    }
  }

  /** READY or CALLED order that keeps a drawer from closing. */
  public record PendingOrder(UUID id, String status, String clientName, Instant createdAt) {}

  /** Delivered orders of a day outside every session window. */
  public record Unsessioned(long orders, long amount) {}

  /** An OPEN or REOPENED session from a previous Bogota day. */
  public record StaleSession(
      UUID id,
      UUID cafeteriaId,
      String cafeteriaName,
      LocalDate businessDate,
      CashSession.Shift shift,
      Instant openedAt) {}

  /** Live figures of an open session, computed now on the server. */
  public record Live(CashBalance balance, long deliveredOrders) {}

  public record Current(
      CashSession session,
      Live live,
      List<Movement> movements,
      List<PendingOrder> pendingOrders,
      Unsessioned unsessionedToday,
      boolean stale,
      int toleranceCop,
      int settingsVersion,
      LocalDate businessDate) {}

  public record ClosePreview(
      CashBalance balance,
      long counted,
      long difference,
      CashBalance.Outcome outcome,
      boolean withinTolerance,
      int toleranceCop,
      boolean noteRequired,
      List<PendingOrder> pendingOrders,
      int version) {}

  public record Detail(
      CashSession session, List<Movement> movements, Map<Integer, Integer> countLines) {}

  public record Listing(
      List<CashSession> sessions,
      List<StaleSession> staleSessions,
      Unsessioned unsessionedToday,
      Integer toleranceCop,
      Integer settingsVersion,
      LocalDate businessDate) {}
}

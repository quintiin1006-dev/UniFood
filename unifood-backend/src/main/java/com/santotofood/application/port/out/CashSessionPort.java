package com.santotofood.application.port.out;

import com.santotofood.application.model.CashSession;
import com.santotofood.application.model.CashViews;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/** Persistence of cash sessions (migration 028). Lock order: settings row, session, orders. */
public interface CashSessionPort {
  record Settings(int toleranceCop, int version) {}

  /** Delivered orders in a window; {@code fractional} if any total has cents. */
  record Sales(BigDecimal amount, long orders, boolean fractional) {}

  record MovementTotals(long income, long expense) {}

  record NewSession(
      UUID cafeteriaId,
      CashSession.Shift shift,
      LocalDate businessDate,
      int sequenceNumber,
      long openingFloat,
      UUID openedBy,
      Instant openedAt) {}

  record Closing(
      UUID sessionId,
      int expectedVersion,
      UUID closedBy,
      Instant closedAt,
      long salesCash,
      long incomeTotal,
      long expenseTotal,
      long expectedCash,
      long countedCash,
      long difference,
      int toleranceCop,
      String note,
      int pendingOrders,
      boolean forced) {}

  /** {@code SET LOCAL lock_timeout}: a busy drawer fails fast instead of blocking deliveries. */
  void setLockTimeout();

  void setAuditActor(UUID actorId);

  boolean cafeteriaExists(UUID cafeteriaId);

  Optional<Settings> lockSettings(UUID cafeteriaId);

  Optional<Settings> findSettings(UUID cafeteriaId);

  int nextSequence(UUID cafeteriaId);

  boolean updateTolerance(
      UUID cafeteriaId, int toleranceCop, int expectedVersion, Instant at, UUID by);

  Optional<CashSession> findOpenSession(UUID cafeteriaId);

  boolean shiftUsed(UUID cafeteriaId, LocalDate businessDate, CashSession.Shift shift);

  UUID insertSession(NewSession session);

  /** The session, locked FOR UPDATE, only if it belongs to the cafeteria. */
  Optional<CashSession> lockSession(UUID sessionId, UUID cafeteriaId);

  /** {@code cafeteriaId} null reads any cafeteria (SUPER_ADMIN). */
  Optional<CashSession> findSession(UUID sessionId, UUID cafeteriaId);

  int latestSequence(UUID cafeteriaId);

  Sales sales(UUID cafeteriaId, Instant from, Instant to);

  MovementTotals movementTotals(UUID sessionId);

  /** READY and CALLED orders, oldest first; {@code lock} takes them FOR SHARE. */
  List<CashViews.PendingOrder> pendingOrders(UUID cafeteriaId, boolean lock);

  Optional<CashViews.Movement> findMovementByRequest(UUID sessionId, UUID requestId);

  void insertMovement(
      UUID sessionId,
      UUID requestId,
      CashViews.Movement.Kind kind,
      long amount,
      String reason,
      UUID createdBy,
      Instant createdAt);

  List<CashViews.Movement> movements(UUID sessionId);

  void replaceCountLines(UUID sessionId, Map<Integer, Integer> quantities);

  Map<Integer, Integer> countLines(UUID sessionId);

  boolean close(Closing closing);

  boolean reopen(UUID sessionId, int expectedVersion, UUID by, Instant at, String reason);

  /** {@code cafeteriaId} null lists every cafeteria. Newest first, at most 500 rows. */
  List<CashSession> list(UUID cafeteriaId, LocalDate from, LocalDate to);

  List<CashViews.StaleSession> staleSessions(UUID cafeteriaId, LocalDate today);

  CashViews.Unsessioned unsessioned(UUID cafeteriaId, Instant from, Instant to);
}

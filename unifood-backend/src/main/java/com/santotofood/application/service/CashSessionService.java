package com.santotofood.application.service;

import com.santotofood.application.exception.CashException;
import com.santotofood.application.model.CashSession;
import com.santotofood.application.model.CashViews;
import com.santotofood.application.port.in.CloseCashSessionUseCase;
import com.santotofood.application.port.in.GetCashSessionUseCase;
import com.santotofood.application.port.in.GetCurrentCashSessionUseCase;
import com.santotofood.application.port.in.ListCashSessionsUseCase;
import com.santotofood.application.port.in.OpenCashSessionUseCase;
import com.santotofood.application.port.in.PreviewCashCloseUseCase;
import com.santotofood.application.port.in.RecordCashMovementUseCase;
import com.santotofood.application.port.in.ReopenCashSessionUseCase;
import com.santotofood.application.port.in.UpdateCashToleranceUseCase;
import com.santotofood.application.port.out.CashSessionPort;
import com.santotofood.domain.model.BusinessDate;
import com.santotofood.domain.model.CashBalance;
import com.santotofood.domain.model.CashCount;
import com.santotofood.domain.port.out.TimeProvider;
import java.math.RoundingMode;
import java.time.Instant;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Cash register per cafeteria and shift (docs/decisiones.md §14). Internal control for a cash-only
 * cafeteria; it does not replace invoicing and never changes an order total.
 *
 * <p>The cafeteria always comes from the database facts of the caller, never from the request.
 * Sales are the totals of orders DELIVERED inside the session window [opened_at, closed_at), read
 * at close time in the same transaction, after locking the READY and CALLED orders: a delivery that
 * commits first is counted, one that starts later waits and falls after closed_at.
 */
@Service
public class CashSessionService
    implements OpenCashSessionUseCase,
        RecordCashMovementUseCase,
        PreviewCashCloseUseCase,
        CloseCashSessionUseCase,
        ReopenCashSessionUseCase,
        GetCurrentCashSessionUseCase,
        GetCashSessionUseCase,
        ListCashSessionsUseCase,
        UpdateCashToleranceUseCase {
  static final long MAX_AMOUNT = 100_000_000L;
  private final OrderAuthorizationService authorization;
  private final CashSessionPort port;
  private final TimeProvider time;

  public CashSessionService(
      OrderAuthorizationService authorization, CashSessionPort port, TimeProvider time) {
    this.authorization = authorization;
    this.port = port;
    this.time = time;
  }

  // ---------------------------------------------------------------- policy

  private CashViews.Operator operator(UUID user) {
    Objects.requireNonNull(user);
    return authorization
        .cashOperator(user)
        .filter(op -> port.cafeteriaExists(op.cafeteriaId()))
        .orElseThrow(CashException::forbidden);
  }

  private CashViews.Operator admin(UUID user) {
    var op = operator(user);
    if (!op.admin()) throw CashException.adminOnly();
    return op;
  }

  private boolean superAdmin(UUID user) {
    return authorization.superAdmin(Objects.requireNonNull(user));
  }

  // ---------------------------------------------------------------- arithmetic

  private long pesos(CashSessionPort.Sales sales, boolean strict) {
    if (sales.fractional() && strict) throw CashException.fractionalOrderTotal();
    // Informative live figures only; a close with cents is refused above.
    return sales.amount().setScale(0, RoundingMode.HALF_UP).longValueExact();
  }

  private CashBalance balance(CashSession session, Instant to, boolean strict) {
    var sales = port.sales(session.cafeteriaId(), session.openedAt(), to);
    var totals = port.movementTotals(session.id());
    return new CashBalance(
        session.openingFloat(), pesos(sales, strict), totals.income(), totals.expense());
  }

  private CashViews.Live live(CashSession session, Instant now) {
    var sales = port.sales(session.cafeteriaId(), session.openedAt(), now);
    var totals = port.movementTotals(session.id());
    return new CashViews.Live(
        new CashBalance(
            session.openingFloat(), pesos(sales, false), totals.income(), totals.expense()),
        sales.orders());
  }

  private CashViews.ClosePreview preview(
      CashSession session,
      CashBalance balance,
      CashCount count,
      int tolerance,
      List<CashViews.PendingOrder> pending) {
    long counted = count.total();
    long difference = balance.difference(counted);
    return new CashViews.ClosePreview(
        balance,
        counted,
        difference,
        CashBalance.outcome(difference),
        CashBalance.withinTolerance(difference, tolerance),
        tolerance,
        difference != 0,
        pending,
        session.version());
  }

  private static String trimmed(String value) {
    if (value == null) return null;
    String clean = value.strip();
    return clean.isEmpty() ? null : clean;
  }

  private static void amount(long value, long min) {
    if (value < min || value > MAX_AMOUNT) throw CashException.invalidAmount();
  }

  private int tolerance(UUID cafeteriaId) {
    return port.findSettings(cafeteriaId).map(CashSessionPort.Settings::toleranceCop).orElse(2000);
  }

  // ---------------------------------------------------------------- reads

  private CashViews.Current current(CashViews.Operator op, Instant now) {
    UUID cafeteria = op.cafeteriaId();
    var today = BusinessDate.from(now);
    var settings = port.findSettings(cafeteria).orElse(new CashSessionPort.Settings(2000, 0));
    var session = port.findOpenSession(cafeteria).orElse(null);
    var unsessioned =
        port.unsessioned(cafeteria, today.dayStartInstant(), today.nextDayStartInstant());
    var pending = port.pendingOrders(cafeteria, false);
    if (session == null)
      return new CashViews.Current(
          null,
          null,
          List.of(),
          pending,
          unsessioned,
          false,
          settings.toleranceCop(),
          settings.version(),
          today.value());
    return new CashViews.Current(
        session,
        live(session, now),
        port.movements(session.id()),
        pending,
        unsessioned,
        session.businessDate().isBefore(today.value()),
        settings.toleranceCop(),
        settings.version(),
        today.value());
  }

  private CashViews.Detail detail(CashSession session) {
    Map<Integer, Integer> lines =
        session.status() == CashSession.Status.CLOSED ? port.countLines(session.id()) : Map.of();
    return new CashViews.Detail(session, port.movements(session.id()), lines);
  }

  @Override
  @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ, timeout = 15)
  public CashViews.Current currentSession(UUID user) {
    return current(operator(user), time.now());
  }

  @Override
  @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ, timeout = 15)
  public CashViews.Detail getSession(UUID user, UUID sessionId) {
    Objects.requireNonNull(sessionId);
    UUID cafeteria = superAdmin(user) ? null : operator(user).cafeteriaId();
    return detail(port.findSession(sessionId, cafeteria).orElseThrow(CashException::notFound));
  }

  @Override
  @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ, timeout = 15)
  public CashViews.Listing listSessions(UUID user, UUID cafeteriaId, LocalDate from, LocalDate to) {
    if (from == null || to == null || from.isAfter(to)) throw CashException.invalidRange();
    if (ChronoUnit.DAYS.between(from, to) + 1 > MAX_DAYS) throw CashException.invalidRange();
    var today = BusinessDate.from(time.now());
    if (superAdmin(user)) {
      if (cafeteriaId != null && !port.cafeteriaExists(cafeteriaId))
        throw CashException.invalidRequest();
      return new CashViews.Listing(
          port.list(cafeteriaId, from, to),
          port.staleSessions(cafeteriaId, today.value()),
          cafeteriaId == null
              ? null
              : port.unsessioned(cafeteriaId, today.dayStartInstant(), today.nextDayStartInstant()),
          null,
          null,
          today.value());
    }
    if (cafeteriaId != null) throw CashException.forbidden();
    var op = admin(user);
    var settings =
        port.findSettings(op.cafeteriaId()).orElse(new CashSessionPort.Settings(2000, 0));
    return new CashViews.Listing(
        port.list(op.cafeteriaId(), from, to),
        port.staleSessions(op.cafeteriaId(), today.value()),
        port.unsessioned(op.cafeteriaId(), today.dayStartInstant(), today.nextDayStartInstant()),
        settings.toleranceCop(),
        settings.version(),
        today.value());
  }

  @Override
  @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ, timeout = 15)
  public CashViews.ClosePreview previewClose(UUID user, UUID sessionId, CashCount count) {
    Objects.requireNonNull(sessionId);
    Objects.requireNonNull(count);
    var op = operator(user);
    var session =
        port.findSession(sessionId, op.cafeteriaId()).orElseThrow(CashException::notFound);
    if (!session.open()) throw CashException.sessionClosed();
    return preview(
        session,
        balance(session, time.now(), true),
        count,
        tolerance(op.cafeteriaId()),
        port.pendingOrders(op.cafeteriaId(), false));
  }

  // ---------------------------------------------------------------- writes

  @Override
  @Transactional(isolation = Isolation.READ_COMMITTED, timeout = 15)
  public CashViews.Current openSession(UUID user, CashSession.Shift shift, long openingFloat) {
    Objects.requireNonNull(shift);
    amount(openingFloat, 0);
    var op = operator(user);
    port.setLockTimeout();
    port.lockSettings(op.cafeteriaId())
        .orElseThrow(() -> new IllegalStateException("Cafeteria without cash settings"));
    Instant now = time.now();
    LocalDate today = BusinessDate.from(now).value();
    var open = port.findOpenSession(op.cafeteriaId());
    if (open.isPresent())
      throw open.get().businessDate().isBefore(today)
          ? CashException.staleOpen(open.get().businessDate())
          : CashException.alreadyOpen();
    if (port.shiftUsed(op.cafeteriaId(), today, shift)) throw CashException.shiftUsed();
    int sequence = port.nextSequence(op.cafeteriaId());
    port.setAuditActor(op.userId());
    port.insertSession(
        new CashSessionPort.NewSession(
            op.cafeteriaId(), shift, today, sequence, openingFloat, op.userId(), now));
    return current(op, now);
  }

  @Override
  @Transactional(isolation = Isolation.READ_COMMITTED, timeout = 15)
  public CashViews.Current recordMovement(
      UUID user,
      UUID sessionId,
      UUID requestId,
      CashViews.Movement.Kind kind,
      long amount,
      String reason) {
    Objects.requireNonNull(sessionId);
    Objects.requireNonNull(requestId);
    Objects.requireNonNull(kind);
    amount(amount, 1);
    String clean = trimmed(reason);
    if (clean == null
        || clean.codePointCount(0, clean.length()) < 3
        || clean.codePointCount(0, clean.length()) > 200) throw CashException.reasonRequired();
    var op = operator(user);
    port.setLockTimeout();
    var session =
        port.lockSession(sessionId, op.cafeteriaId()).orElseThrow(CashException::notFound);
    Instant now = time.now();
    // A retry of a movement that already landed answers with the current state, unchanged.
    if (port.findMovementByRequest(sessionId, requestId).isPresent()) return current(op, now);
    if (!session.open()) throw CashException.sessionClosed();
    if (kind == CashViews.Movement.Kind.EXPENSE
        && !balance(session, now, false).allowsExpense(amount))
      throw CashException.expenseExceedsBalance();
    port.setAuditActor(op.userId());
    port.insertMovement(sessionId, requestId, kind, amount, clean, op.userId(), now);
    return current(op, now);
  }

  @Override
  @Transactional(isolation = Isolation.READ_COMMITTED, timeout = 15)
  public CashViews.Detail closeSession(UUID user, Command command) {
    Objects.requireNonNull(command);
    Objects.requireNonNull(command.sessionId());
    Objects.requireNonNull(command.count());
    String note = trimmed(command.note());
    if (note != null && note.codePointCount(0, note.length()) > 500)
      throw CashException.noteTooLong();
    var op = operator(user);
    if (command.force() && !op.admin()) throw CashException.adminOnly();
    port.setLockTimeout();
    var settings =
        port.lockSettings(op.cafeteriaId())
            .orElseThrow(() -> new IllegalStateException("Cafeteria without cash settings"));
    var session =
        port.lockSession(command.sessionId(), op.cafeteriaId())
            .orElseThrow(CashException::notFound);
    if (!session.open()) throw CashException.sessionClosed();
    if (session.version() != command.expectedVersion()) throw CashException.stateChanged();
    // FOR SHARE: a delivery in flight finishes first (and is counted); a later one waits.
    var pending = port.pendingOrders(op.cafeteriaId(), true);
    if (!pending.isEmpty() && !command.force()) throw CashException.pendingOrders(pending);
    Instant closedAt = time.now();
    var balance = balance(session, closedAt, true);
    var preview = preview(session, balance, command.count(), settings.toleranceCop(), pending);
    if (balance.expected() != command.expectedCash()) throw CashException.expectedChanged(preview);
    if (note != null && note.codePointCount(0, note.length()) < 10)
      throw CashException.noteRequired();
    if (preview.difference() != 0 && note == null) throw CashException.noteRequired();
    port.setAuditActor(op.userId());
    port.replaceCountLines(session.id(), command.count().quantities());
    boolean closed =
        port.close(
            new CashSessionPort.Closing(
                session.id(),
                session.version(),
                op.userId(),
                closedAt,
                balance.sales(),
                balance.income(),
                balance.expense(),
                balance.expected(),
                preview.counted(),
                preview.difference(),
                settings.toleranceCop(),
                note,
                pending.size(),
                !pending.isEmpty()));
    if (!closed) throw CashException.stateChanged();
    return detail(port.findSession(session.id(), op.cafeteriaId()).orElseThrow());
  }

  @Override
  @Transactional(isolation = Isolation.READ_COMMITTED, timeout = 15)
  public CashViews.Detail reopenSession(
      UUID user, UUID sessionId, String reason, int expectedVersion) {
    Objects.requireNonNull(sessionId);
    String clean = trimmed(reason);
    if (clean == null
        || clean.codePointCount(0, clean.length()) < 10
        || clean.codePointCount(0, clean.length()) > 300)
      throw CashException.reopenReasonRequired();
    var op = admin(user);
    port.setLockTimeout();
    port.lockSettings(op.cafeteriaId())
        .orElseThrow(() -> new IllegalStateException("Cafeteria without cash settings"));
    var session =
        port.lockSession(sessionId, op.cafeteriaId()).orElseThrow(CashException::notFound);
    if (session.status() != CashSession.Status.CLOSED) throw CashException.notClosed();
    if (session.version() != expectedVersion) throw CashException.stateChanged();
    if (port.findOpenSession(op.cafeteriaId()).isPresent())
      throw CashException.reopenWithOpenDrawer();
    if (port.latestSequence(op.cafeteriaId()) != session.sequenceNumber())
      throw CashException.reopenNotLatest();
    port.setAuditActor(op.userId());
    if (!port.reopen(sessionId, expectedVersion, op.userId(), time.now(), clean))
      throw CashException.stateChanged();
    return detail(port.findSession(sessionId, op.cafeteriaId()).orElseThrow());
  }

  @Override
  @Transactional(isolation = Isolation.READ_COMMITTED, timeout = 15)
  public int updateTolerance(UUID user, int toleranceCop, int expectedVersion) {
    if (toleranceCop < 0 || toleranceCop > MAX_TOLERANCE) throw CashException.invalidAmount();
    if (expectedVersion < 0) throw CashException.invalidRequest();
    var op = admin(user);
    port.setLockTimeout();
    var settings =
        port.lockSettings(op.cafeteriaId())
            .orElseThrow(() -> new IllegalStateException("Cafeteria without cash settings"));
    if (settings.toleranceCop() == toleranceCop) return settings.version(); // repeated: no write
    if (settings.version() != expectedVersion) throw CashException.toleranceChanged();
    port.setAuditActor(op.userId());
    if (!port.updateTolerance(
        op.cafeteriaId(), toleranceCop, expectedVersion, time.now(), op.userId()))
      throw CashException.toleranceChanged();
    return expectedVersion + 1;
  }
}

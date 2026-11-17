package com.santotofood.adapter.in.web.dto;

import com.santotofood.application.model.CashSession;
import com.santotofood.application.model.CashViews;
import com.santotofood.domain.model.CashBalance;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** JSON of the cash register endpoints. Amounts are whole COP as JSON integers. */
public final class CashResponses {
  private CashResponses() {}

  public record Cafeteria(UUID id, String name) {}

  public record Session(
      UUID id,
      Cafeteria cafeteria,
      String shift,
      LocalDate businessDate,
      int sequenceNumber,
      String status,
      long openingFloat,
      Instant openedAt,
      String openedByName,
      Instant closedAt,
      String closedByName,
      Long sales,
      Long income,
      Long expense,
      Long expected,
      Long counted,
      Long difference,
      String outcome,
      Integer toleranceCop,
      Boolean outsideTolerance,
      String note,
      Integer pendingOrdersAtClose,
      Boolean forcedClose,
      int reopenCount,
      Instant reopenedAt,
      String reopenedByName,
      String reopenReason,
      int version) {}

  public record Movement(
      UUID id, String kind, long amount, String reason, Instant createdAt, String createdByName) {}

  public record PendingOrder(UUID id, String status, String clientName, Instant createdAt) {}

  public record Unsessioned(long orders, long amount) {}

  public record Live(
      long openingFloat,
      long sales,
      long deliveredOrders,
      long income,
      long expense,
      long expected) {}

  public record Current(
      LocalDate businessDate,
      Session session,
      Live live,
      List<Movement> movements,
      List<PendingOrder> pendingOrders,
      Unsessioned unsessionedToday,
      boolean stale,
      int toleranceCop,
      int settingsVersion) {}

  public record Preview(
      long openingFloat,
      long sales,
      long income,
      long expense,
      long expected,
      long counted,
      long difference,
      String outcome,
      boolean withinTolerance,
      int toleranceCop,
      boolean noteRequired,
      List<PendingOrder> pendingOrders,
      int version) {}

  public record CountLine(int denomination, int quantity) {}

  public record Detail(Session session, List<Movement> movements, List<CountLine> countLines) {}

  public record StaleSession(
      UUID id, Cafeteria cafeteria, LocalDate businessDate, String shift, Instant openedAt) {}

  public record Listing(
      LocalDate businessDate,
      List<Session> sessions,
      List<StaleSession> staleSessions,
      Unsessioned unsessionedToday,
      Integer toleranceCop,
      Integer settingsVersion) {}

  public record Settings(int toleranceCop, int settingsVersion) {}

  public static Session session(CashSession s) {
    CashBalance.Outcome outcome = s.outcome();
    return new Session(
        s.id(),
        new Cafeteria(s.cafeteriaId(), s.cafeteriaName()),
        s.shift().name(),
        s.businessDate(),
        s.sequenceNumber(),
        s.status().name(),
        s.openingFloat(),
        s.openedAt(),
        s.openedByName(),
        s.closedAt(),
        s.closedByName(),
        s.salesCash(),
        s.incomeTotal(),
        s.expenseTotal(),
        s.expectedCash(),
        s.countedCash(),
        s.difference(),
        outcome == null ? null : outcome.name(),
        s.toleranceCop(),
        s.outsideTolerance(),
        s.note(),
        s.pendingOrdersAtClose(),
        s.forcedClose(),
        s.reopenCount(),
        s.reopenedAt(),
        s.reopenedByName(),
        s.reopenReason(),
        s.version());
  }

  static Movement movement(CashViews.Movement m) {
    return new Movement(
        m.id(), m.kind().name(), m.amount(), m.reason(), m.createdAt(), m.createdByName());
  }

  public static List<PendingOrder> pending(List<CashViews.PendingOrder> orders) {
    return orders == null
        ? null
        : orders.stream()
            .map(o -> new PendingOrder(o.id(), o.status(), o.clientName(), o.createdAt()))
            .toList();
  }

  static Unsessioned unsessioned(CashViews.Unsessioned u) {
    return u == null ? null : new Unsessioned(u.orders(), u.amount());
  }

  public static Current current(CashViews.Current c) {
    Live live = null;
    if (c.live() != null) {
      var b = c.live().balance();
      live =
          new Live(
              b.openingFloat(),
              b.sales(),
              c.live().deliveredOrders(),
              b.income(),
              b.expense(),
              b.expected());
    }
    return new Current(
        c.businessDate(),
        c.session() == null ? null : session(c.session()),
        live,
        c.movements().stream().map(CashResponses::movement).toList(),
        pending(c.pendingOrders()),
        unsessioned(c.unsessionedToday()),
        c.stale(),
        c.toleranceCop(),
        c.settingsVersion());
  }

  public static Preview preview(CashViews.ClosePreview p) {
    var b = p.balance();
    return new Preview(
        b.openingFloat(),
        b.sales(),
        b.income(),
        b.expense(),
        b.expected(),
        p.counted(),
        p.difference(),
        p.outcome().name(),
        p.withinTolerance(),
        p.toleranceCop(),
        p.noteRequired(),
        pending(p.pendingOrders()),
        p.version());
  }

  public static Detail detail(CashViews.Detail d) {
    return new Detail(
        session(d.session()),
        d.movements().stream().map(CashResponses::movement).toList(),
        lines(d.countLines()));
  }

  private static List<CountLine> lines(Map<Integer, Integer> lines) {
    return lines.entrySet().stream().map(e -> new CountLine(e.getKey(), e.getValue())).toList();
  }

  public static Listing listing(CashViews.Listing l) {
    return new Listing(
        l.businessDate(),
        l.sessions().stream().map(CashResponses::session).toList(),
        l.staleSessions().stream()
            .map(
                s ->
                    new StaleSession(
                        s.id(),
                        new Cafeteria(s.cafeteriaId(), s.cafeteriaName()),
                        s.businessDate(),
                        s.shift().name(),
                        s.openedAt()))
            .toList(),
        unsessioned(l.unsessionedToday()),
        l.toleranceCop(),
        l.settingsVersion());
  }
}

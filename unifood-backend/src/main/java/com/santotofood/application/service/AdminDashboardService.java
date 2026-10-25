package com.santotofood.application.service;

import com.santotofood.application.exception.AdminDashboardException;
import com.santotofood.application.model.*;
import com.santotofood.application.model.AdminDashboard.*;
import com.santotofood.application.port.in.GetAdminDashboardUseCase;
import com.santotofood.application.port.out.AdminDashboardQueryPort;
import com.santotofood.application.port.out.AdminDashboardQueryPort.*;
import com.santotofood.application.port.out.AuthorizationQueryPort;
import com.santotofood.domain.port.out.TimeProvider;
import java.math.BigDecimal;
import java.math.BigInteger;
import java.util.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AdminDashboardService implements GetAdminDashboardUseCase {
  private final AuthorizationQueryPort authorization;
  private final AdminDashboardQueryPort queries;
  private final TimeProvider time;

  public AdminDashboardService(
      AuthorizationQueryPort authorization, AdminDashboardQueryPort queries, TimeProvider time) {
    this.authorization = authorization;
    this.queries = queries;
    this.time = time;
  }

  @Override
  @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ, timeout = 15)
  public AdminDashboard getDashboard(UUID authenticatedUserId, AdminDashboardRequest request) {
    Objects.requireNonNull(authenticatedUserId);
    Objects.requireNonNull(request);
    var facts =
        authorization
            .findUserAuthorization(authenticatedUserId)
            .filter(
                u ->
                    u.active() && u.roles().equals(Set.of("ADMIN")) && u.cafeteriaIds().size() == 1)
            .orElseThrow(AdminDashboardService::forbidden);
    UUID cafeteria = facts.cafeteriaIds().getFirst();
    if (!queries.cafeteriaExists(cafeteria)) throw forbidden();
    var period = AdminDashboardPeriod.resolve(request, time.now());
    var query = new Query(cafeteria, period, request.rankingLimit());
    var daily = queries.daily(query);
    var quality = queries.itemQuality(query);
    var dates = queries.dateQuality(query);
    Ranking delivered =
        usable(quality, Event.DELIVERED)
            ? queries.ranking(query, Event.DELIVERED)
            : Ranking.unavailable(query.limit());
    Ranking notCollected =
        usable(quality, Event.NOT_COLLECTED)
            ? queries.ranking(query, Event.NOT_COLLECTED)
            : Ranking.unavailable(query.limit());
    BigInteger receivedCount = count(daily, Event.RECEIVED);
    BigInteger deliveredCount = count(daily, Event.DELIVERED);
    BigInteger notCollectedCount = count(daily, Event.NOT_COLLECTED);
    BigInteger denominator = deliveredCount.add(notCollectedCount);
    var summary =
        new Summary(
            receivedCount,
            deliveredCount,
            notCollectedCount,
            notCollected.totals().units(),
            value(daily, Event.RECEIVED),
            value(daily, Event.DELIVERED),
            value(daily, Event.NOT_COLLECTED),
            notCollected.totals().itemValue(),
            percent(notCollectedCount, denominator),
            denominator);
    List<Trend> trend =
        period
            .from()
            .datesUntil(period.to().plusDays(1))
            .map(
                date -> {
                  var rows = daily.stream().filter(row -> row.date().equals(date)).toList();
                  return new Trend(
                      date,
                      count(rows, Event.RECEIVED),
                      count(rows, Event.DELIVERED),
                      count(rows, Event.NOT_COLLECTED));
                })
            .toList();
    List<Check> checks = new ArrayList<>();
    List<Warning> warnings = new ArrayList<>();
    for (var date : dates) {
      checks.add(
          check(
              "TERMINAL_DATE_VALIDITY",
              date.basis(),
              date.basis().equals("CREATED_COHORT")
                  ? List.of("RECEIVED")
                  : List.of("DELIVERED", "NOT_COLLECTED"),
              date.examined(),
              date.affected(),
              period));
      if (date.affected().signum() > 0)
        warnings.add(
            new Warning("INVALID_TERMINAL_DATES_" + date.basis(), List.of("TERMINAL_METRICS")));
    }
    for (Event event : Event.values()) {
      BigInteger invalid =
          daily.stream()
              .filter(d -> d.event() == event)
              .map(Daily::invalidAmounts)
              .reduce(BigInteger.ZERO, BigInteger::add);
      checks.add(
          check(
              "HEADER_AMOUNT_VALIDITY",
              "SELECTED_EVENT_ORDERS",
              List.of(event.name()),
              count(daily, event),
              invalid,
              period));
      if (invalid.signum() > 0)
        warnings.add(
            new Warning("INVALID_HEADER_AMOUNT_" + event, List.of(event + "_ORDER_VALUE")));
      var item =
          quality.stream()
              .filter(q -> q.event() == event)
              .findFirst()
              .orElse(
                  new ItemQuality(
                      event,
                      BigInteger.ZERO,
                      BigInteger.ZERO,
                      BigInteger.ZERO,
                      BigInteger.ZERO,
                      BigInteger.ZERO));
      checks.add(
          check(
              "ITEM_INTEGRITY",
              "SELECTED_EVENT_ORDERS",
              List.of(event.name()),
              item.examined(),
              item.unusable(),
              period));
      checks.add(
          check(
              "HEADER_ITEM_RECONCILIATION",
              "SELECTED_EVENT_ORDERS",
              List.of(event.name()),
              item.reconcilable(),
              item.mismatched(),
              period));
      checks.add(
          check(
              "HISTORICAL_NAME",
              "SELECTED_EVENT_ORDERS",
              List.of(event.name()),
              item.examined(),
              item.missingNames(),
              period));
      if (item.unusable().signum() > 0)
        warnings.add(new Warning("INCOMPLETE_ITEMS_" + event, List.of(event + "_ITEM_METRICS")));
      if (item.mismatched().signum() > 0)
        warnings.add(new Warning("HEADER_ITEM_MISMATCH_" + event, List.of(event + "_VALUES")));
      if (item.missingNames().signum() > 0)
        warnings.add(
            new Warning("MISSING_HISTORICAL_NAME_" + event, List.of(event + "_PRODUCT_NAMES")));
    }
    checks.add(
        new Check(
            "UNDATED_TERMINALS",
            "NOT_CHECKED",
            new Scope(
                "CAFETERIA_ALL_HISTORY",
                List.of("DELIVERED", "NOT_COLLECTED", "CANCELLED"),
                null,
                null),
            null,
            null,
            period.asOf()));
    warnings.add(new Warning("UNDATED_TERMINALS_NOT_ASSESSED", List.of("TERMINAL_METRICS")));
    warnings.add(new Warning("UNVERIFIED_ORDER_PROVENANCE", List.of("ALL_METRICS")));
    if (receivedCount.add(denominator).signum() == 0)
      warnings.add(new Warning("NO_VERIFIABLE_EVENTS", List.of("ALL_METRICS")));
    return new AdminDashboard(
        period,
        summary,
        trend,
        delivered,
        notCollected,
        new Coverage("LIMITED", period.asOf(), checks, new Provenance("UNKNOWN", null), warnings));
  }

  private static Check check(
      String code,
      String basis,
      List<String> events,
      BigInteger examined,
      BigInteger affected,
      AdminDashboardPeriod period) {
    return new Check(
        code,
        affected.signum() == 0 ? "PASS" : "WARN",
        new Scope(basis, events, period.startInclusive(), period.endExclusive()),
        examined,
        affected,
        period.asOf());
  }

  private static boolean usable(List<ItemQuality> quality, Event event) {
    return quality.stream()
        .filter(q -> q.event() == event)
        .allMatch(q -> q.unusable().signum() == 0);
  }

  private static BigInteger count(List<Daily> daily, Event event) {
    return daily.stream()
        .filter(d -> d.event() == event)
        .map(Daily::orders)
        .reduce(BigInteger.ZERO, BigInteger::add);
  }

  private static BigDecimal value(List<Daily> daily, Event event) {
    var rows = daily.stream().filter(d -> d.event() == event).toList();
    if (rows.stream().anyMatch(d -> d.value() == null)) return null;
    return rows.stream().map(Daily::value).reduce(BigDecimal.ZERO, BigDecimal::add);
  }

  public static BigDecimal percent(BigInteger units, BigInteger total) {
    return AdminDashboard.percentage(units, total);
  }

  private static AdminDashboardException forbidden() {
    return new AdminDashboardException(AdminDashboardException.Reason.FORBIDDEN);
  }
}

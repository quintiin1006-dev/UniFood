package com.santotofood.application.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.santotofood.adapter.in.web.dto.AdminDashboardResponse;
import com.santotofood.application.exception.AdminDashboardException;
import com.santotofood.application.model.*;
import com.santotofood.application.port.out.AdminDashboardQueryPort;
import com.santotofood.application.port.out.AdminDashboardQueryPort.*;
import com.santotofood.application.port.out.AuthorizationQueryPort;
import com.santotofood.domain.port.out.TimeProvider;
import java.math.BigDecimal;
import java.math.BigInteger;
import java.time.Instant;
import java.time.LocalDate;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

class AdminDashboardServiceTest {
  final UUID user = UUID.randomUUID(), cafe = UUID.randomUUID();
  final AuthorizationQueryPort auth = mock(AuthorizationQueryPort.class);
  final AdminDashboardQueryPort queries = mock(AdminDashboardQueryPort.class);
  final TimeProvider time = mock(TimeProvider.class);
  final AdminDashboardService service = new AdminDashboardService(auth, queries, time);
  final AdminDashboardRequest today = request("TODAY");

  static AdminDashboardRequest request(String range) {
    return AdminDashboardRequest.parse(Map.of("range", List.of(range)));
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "ABSENT",
        "INACTIVE",
        "CLIENT",
        "WORKER",
        "SUPER_ADMIN",
        "MIXED",
        "NONE",
        "AMBIGUOUS",
        "DUPLICATE"
      })
  void rejectsInvalidBusinessIdentityBeforeQueries(String scenario) {
    Set<String> roles =
        switch (scenario) {
          case "CLIENT", "WORKER", "SUPER_ADMIN" -> Set.of(scenario);
          case "MIXED" -> Set.of("ADMIN", "WORKER");
          default -> Set.of("ADMIN");
        };
    List<UUID> assignments =
        switch (scenario) {
          case "NONE" -> List.of();
          case "AMBIGUOUS" -> List.of(cafe, UUID.randomUUID());
          case "DUPLICATE" -> List.of(cafe, cafe);
          default -> List.of(cafe);
        };
    when(auth.findUserAuthorization(user))
        .thenReturn(
            scenario.equals("ABSENT")
                ? Optional.empty()
                : Optional.of(
                    new UserAuthorization(!scenario.equals("INACTIVE"), roles, assignments)));
    var error =
        assertThrows(AdminDashboardException.class, () -> service.getDashboard(user, today));
    assertEquals(AdminDashboardException.Reason.FORBIDDEN, error.reason());
    verifyNoInteractions(queries, time);
  }

  void admit() {
    when(auth.findUserAuthorization(user))
        .thenReturn(Optional.of(new UserAuthorization(true, Set.of("ADMIN"), List.of(cafe))));
    when(queries.cafeteriaExists(cafe)).thenReturn(true);
    when(time.now()).thenReturn(Instant.parse("2026-10-24T17:00:00Z"));
    when(queries.ranking(any(), any()))
        .thenAnswer(
            invocation ->
                new AdminDashboard.Ranking(
                    "AVAILABLE",
                    10,
                    false,
                    new AdminDashboard.Totals(
                        BigInteger.ZERO, BigInteger.ZERO, BigInteger.ZERO, BigDecimal.ZERO),
                    new AdminDashboard.Omitted(BigInteger.ZERO, BigInteger.ZERO, BigDecimal.ZERO),
                    List.of()));
  }

  @Test
  void checksCafeteriaExistenceBeforeClockAndAggregates() {
    admit();
    when(queries.cafeteriaExists(cafe)).thenReturn(false);
    assertThrows(AdminDashboardException.class, () -> service.getDashboard(user, today));
    verifyNoInteractions(time);
    verify(queries, never()).daily(any());
  }

  @Test
  void oneClockSnapshotAndEmptyCoverageNeverCertifiesTheHistory() {
    admit();
    var result = service.getDashboard(user, today);
    verify(time, times(1)).now();
    verify(queries)
        .daily(
            argThat(
                q ->
                    q.cafeteriaId().equals(cafe)
                        && q.period().startInclusive().equals(Instant.parse("2026-10-24T05:00:00Z"))
                        && q.period()
                            .endExclusive()
                            .equals(Instant.parse("2026-10-24T17:00:00Z"))));
    assertNull(result.summary().notCollectedRatePercent());
    assertEquals(BigInteger.ZERO, result.summary().notCollectedRateDenominator());
    assertEquals(1, result.trend().size());
    assertEquals("LIMITED", result.coverage().assessment());
    assertTrue(
        result.coverage().checks().stream()
            .anyMatch(
                c ->
                    c.status().equals("NOT_CHECKED")
                        && c.examinedOrders() == null
                        && c.affectedOrders() == null));
    assertTrue(
        result.coverage().warnings().stream()
            .anyMatch(w -> w.code().equals("NO_VERIFIABLE_EVENTS")));
  }

  @Test
  void exactLargeNumbersNullAmountsAndPartialItemsSurviveTheContract() {
    admit();
    BigInteger huge = new BigInteger("9007199254740993");
    LocalDate day = LocalDate.parse("2026-10-24");
    when(queries.daily(any()))
        .thenReturn(
            List.of(
                new Daily(
                    day,
                    Event.RECEIVED,
                    huge,
                    new BigDecimal("99999999999999999999.99"),
                    BigInteger.ZERO),
                new Daily(day, Event.DELIVERED, BigInteger.TWO, null, BigInteger.ONE),
                new Daily(
                    day,
                    Event.NOT_COLLECTED,
                    BigInteger.ONE,
                    new BigDecimal("12.34"),
                    BigInteger.ZERO)));
    when(queries.itemQuality(any()))
        .thenReturn(
            List.of(
                new ItemQuality(
                    Event.NOT_COLLECTED,
                    BigInteger.ONE,
                    BigInteger.ONE,
                    BigInteger.ZERO,
                    BigInteger.ZERO,
                    BigInteger.ZERO)));
    var model = service.getDashboard(user, today);
    var response = AdminDashboardResponse.from(model);
    assertEquals(huge.toString(), response.summary().receivedOrders());
    assertEquals("99999999999999999999.99", response.summary().receivedOrderValue());
    assertNull(response.summary().deliveredOrderValue());
    assertEquals("33.33", response.summary().notCollectedRatePercent());
    assertEquals("3", response.summary().notCollectedRateDenominator());
    assertNull(response.summary().notCollectedUnits());
    assertEquals("UNAVAILABLE_INCOMPLETE_ITEMS", response.notCollectedProducts().availability());
    verify(queries, never()).ranking(any(), eq(Event.NOT_COLLECTED));
    assertEquals(
        model.summary().receivedOrders(),
        model.trend().stream()
            .map(AdminDashboard.Trend::receivedOrders)
            .reduce(BigInteger.ZERO, BigInteger::add));
  }

  @Test
  void decimalPercentUsesHalfUpAndNullDenominator() {
    assertEquals(
        new BigDecimal("0.01"),
        AdminDashboardService.percent(BigInteger.ONE, BigInteger.valueOf(20000)));
    assertEquals(
        new BigDecimal("66.67"),
        AdminDashboardService.percent(BigInteger.TWO, BigInteger.valueOf(3)));
    assertNull(AdminDashboardService.percent(BigInteger.ZERO, BigInteger.ZERO));
  }
}

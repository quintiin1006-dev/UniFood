package com.santotofood.application.service;

import static org.junit.jupiter.api.Assertions.*;

import com.santotofood.application.exception.AdminDashboardException;
import com.santotofood.application.model.AdminDashboardPeriod;
import com.santotofood.application.model.AdminDashboardRequest;
import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

class AdminDashboardRequestTest {
  static Map<String, List<String>> parameters(String text) {
    Map<String, List<String>> result = new HashMap<>();
    if (!text.isEmpty())
      for (String pair : text.split("&")) {
        var parts = pair.split("=", -1);
        result
            .computeIfAbsent(parts[0], k -> new ArrayList<>())
            .add(parts.length > 1 ? parts[1] : "");
      }
    return result;
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "",
        "range=",
        "range=today",
        "range=MONTH",
        "range=TODAY&range=TODAY",
        "range=TODAY&from=2026-10-24",
        "range=TODAY&to=2026-10-24",
        "range=CUSTOM",
        "range=CUSTOM&from=2026-02-30&to=2026-03-01",
        "range=CUSTOM&from=2026-1-01&to=2026-01-01",
        "range=CUSTOM&from=2026-10-25&to=2026-10-24",
        "range=CUSTOM&from=2025-01-01&to=2026-01-02",
        "range=TODAY&rankingLimit=0",
        "range=TODAY&rankingLimit=51",
        "range=TODAY&rankingLimit=-1",
        "range=TODAY&rankingLimit=1.0",
        "range=TODAY&rankingLimit=",
        "range=TODAY&rankingLimit=01",
        "range=TODAY&rankingLimit=999999999999999999999",
        "range=TODAY&rankingLimit=1&rankingLimit=2",
        "range=TODAY&cafeteriaId=foreign",
        "range=TODAY&userId=foreign",
        "range=TODAY&timezone=UTC",
        "range=TODAY&asOf=2026-10-24",
        "range=TODAY&unknown=x"
      })
  void invalidFilters(String text) {
    assertThrows(
        AdminDashboardException.class, () -> AdminDashboardRequest.parse(parameters(text)));
  }

  @ParameterizedTest
  @ValueSource(strings = {"TODAY", "LAST_7_DAYS", "LAST_30_DAYS"})
  void bogotaCalendarCrossesMonthAndYearWithoutWorkerClipping(String range) {
    var request = AdminDashboardRequest.parse(parameters("range=" + range));
    var period = AdminDashboardPeriod.resolve(request, Instant.parse("2027-01-01T04:59:59Z"));
    assertEquals("2026-12-31", period.to().toString());
    assertEquals(
        switch (range) {
          case "TODAY" -> "2026-12-31";
          case "LAST_7_DAYS" -> "2026-12-25";
          default -> "2026-12-02";
        },
        period.from().toString());
    assertEquals(Instant.parse("2027-01-01T04:59:59Z"), period.endExclusive());
    assertTrue(period.partial());
    assertEquals(10, request.rankingLimit());
  }

  @Test
  void customLeapYear366DaysAndCompletedPeriod() {
    var request =
        AdminDashboardRequest.parse(
            parameters("range=CUSTOM&from=2024-01-01&to=2024-12-31&rankingLimit=50"));
    var period = AdminDashboardPeriod.resolve(request, Instant.parse("2026-10-24T17:00:00Z"));
    assertEquals(Instant.parse("2025-01-01T05:00:00Z"), period.endExclusive());
    assertFalse(period.partial());
    assertEquals(50, request.rankingLimit());
  }

  @Test
  void futureDateRejectedAndMidnightHasEmptyInterval() {
    var future =
        AdminDashboardRequest.parse(parameters("range=CUSTOM&from=2026-10-25&to=2026-10-25"));
    assertThrows(
        AdminDashboardException.class,
        () -> AdminDashboardPeriod.resolve(future, Instant.parse("2026-10-24T17:00:00Z")));
    var period =
        AdminDashboardPeriod.resolve(
            AdminDashboardServiceTest.request("TODAY"), Instant.parse("2026-10-24T05:00:00Z"));
    assertEquals(period.startInclusive(), period.endExclusive());
  }
}

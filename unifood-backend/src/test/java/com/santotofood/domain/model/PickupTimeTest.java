package com.santotofood.domain.model;

import static org.junit.jupiter.api.Assertions.*;

import java.time.Instant;
import org.junit.jupiter.api.Test;

class PickupTimeTest {
  // 2026-11-20 12:00 in America/Bogota (UTC-5, no daylight saving).
  static final Instant NOW = Instant.parse("2026-11-20T17:00:00Z");

  static PickupTime at(String text) {
    return PickupTime.parse(text).orElseThrow();
  }

  @Test
  void parsesIso8601WithAnExplicitOffsetToTheSameInstant() {
    assertEquals(Instant.parse("2026-11-20T18:30:00Z"), at("2026-11-20T13:30:00-05:00").value());
    assertEquals(Instant.parse("2026-11-20T18:30:00Z"), at("2026-11-20T18:30:00Z").value());
    assertEquals(Instant.parse("2026-11-20T18:30:00Z"), at("2026-11-20T18:30Z").value());
    assertEquals(at("2026-11-20T13:30:00-05:00"), at("2026-11-20T18:30:00.000Z"));
  }

  @Test
  void refusesTextWithoutOffsetOrMalformed() {
    for (var bad :
        new String[] {
          "",
          "13:30",
          "2026-11-20",
          "2026-11-20T13:30:00",
          "2026-11-20 13:30:00-05:00",
          "2026-02-30T13:30:00-05:00",
          "2026-11-20T25:00:00Z",
          "1763659800",
          "mañana"
        }) assertTrue(PickupTime.parse(bad).isEmpty(), bad);
    assertTrue(PickupTime.parse(null).isEmpty());
  }

  @Test
  void keepsMicrosecondsLikePostgresql() {
    assertEquals(
        Instant.parse("2026-11-20T18:30:00.123456Z"), at("2026-11-20T18:30:00.123456789Z").value());
  }

  @Test
  void mustBeLaterThanNowAndWithinTodayInBogota() {
    assertTrue(at("2026-11-20T12:01:00-05:00").isValidAt(NOW));
    assertTrue(at("2026-11-20T23:59:59-05:00").isValidAt(NOW));
    // Now itself and the past are refused.
    assertFalse(at("2026-11-20T12:00:00-05:00").isValidAt(NOW));
    assertFalse(at("2026-11-20T11:00:00-05:00").isValidAt(NOW));
    // Midnight in Bogotá already belongs to the next business day.
    assertFalse(at("2026-11-21T00:00:00-05:00").isValidAt(NOW));
    assertFalse(at("2026-11-22T12:00:00-05:00").isValidAt(NOW));
  }

  @Test
  void theBusinessDayIsBogotasNotUtcs() {
    // 20:00 in Bogotá is already the 21st in UTC, but it is still today.
    assertTrue(at("2026-11-21T01:00:00Z").isValidAt(NOW));
    // At 23:00 in Bogotá it is already the 21st in UTC; tomorrow morning is still another day.
    var lateEvening = Instant.parse("2026-11-21T04:00:00Z");
    assertTrue(at("2026-11-20T23:30:00-05:00").isValidAt(lateEvening));
    assertFalse(at("2026-11-21T08:00:00-05:00").isValidAt(lateEvening));
  }
}

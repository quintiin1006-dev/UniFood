package com.santotofood.domain.model;

import static org.junit.jupiter.api.Assertions.*;

import java.time.Instant;
import java.time.LocalDate;
import java.util.TimeZone;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;

class BusinessDateTest {
  @ParameterizedTest
  @ValueSource(strings = {"UTC", "Asia/Tokyo", "America/Los_Angeles"})
  void bogotaMidnightIsIndependentOfHostTimezone(String hostZone) {
    var previous = TimeZone.getDefault();
    try {
      TimeZone.setDefault(TimeZone.getTimeZone(hostZone));
      assertEquals(
          LocalDate.of(2026, 10, 12),
          BusinessDate.from(Instant.parse("2026-10-13T04:59:59.999Z")).value());
      assertEquals(
          LocalDate.of(2026, 10, 13),
          BusinessDate.from(Instant.parse("2026-10-13T05:00:00Z")).value());
    } finally {
      TimeZone.setDefault(previous);
    }
  }

  @Test
  void missingDateAndInstantAreRejected() {
    assertThrows(NullPointerException.class, () -> new BusinessDate(null));
    assertThrows(NullPointerException.class, () -> BusinessDate.from(null));
  }

  @ParameterizedTest
  @CsvSource({
    "2026-10-13,2026-10-13T05:00:00Z,2026-10-14T05:00:00Z",
    "2026-12-31,2026-12-31T05:00:00Z,2027-01-01T05:00:00Z",
    "2024-02-29,2024-02-29T05:00:00Z,2024-03-01T05:00:00Z",
    "2025-02-28,2025-02-28T05:00:00Z,2025-03-01T05:00:00Z"
  })
  void boundariesUseTheLocalCalendar(String day, String start, String next) {
    var date = new BusinessDate(LocalDate.parse(day));
    assertEquals(Instant.parse(start), date.dayStartInstant());
    assertEquals(Instant.parse(next), date.nextDayStartInstant());
  }
}

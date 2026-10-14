package com.santotofood.domain.model;

import static org.junit.jupiter.api.Assertions.*;

import java.time.Instant;
import java.time.LocalDate;
import java.util.TimeZone;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
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
}

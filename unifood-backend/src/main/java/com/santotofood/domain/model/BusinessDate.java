package com.santotofood.domain.model;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.Objects;

/** Colombia business date, independent of host/browser/PostgreSQL time zones. */
public record BusinessDate(LocalDate value) {
  private static final ZoneId ZONE = ZoneId.of("America/Bogota");

  public BusinessDate {
    Objects.requireNonNull(value);
  }

  public static BusinessDate from(Instant instant) {
    return new BusinessDate(Objects.requireNonNull(instant).atZone(ZONE).toLocalDate());
  }

  public Instant dayStartInstant() {
    return value.atStartOfDay(ZONE).toInstant();
  }

  public Instant nextDayStartInstant() {
    return value.plusDays(1).atStartOfDay(ZONE).toInstant();
  }
}

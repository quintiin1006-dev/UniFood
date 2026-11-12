package com.santotofood.domain.model;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.time.temporal.ChronoUnit;
import java.util.Objects;
import java.util.Optional;

/**
 * Optional pickup time a client asks for (docs/decisiones.md §6). It is informative only: it never
 * changes the FIFO order of the worker's queue. Kept to the microsecond, as PostgreSQL stores it.
 */
public record PickupTime(Instant value) {

  public PickupTime {
    value = Objects.requireNonNull(value).truncatedTo(ChronoUnit.MICROS);
  }

  /**
   * ISO-8601 with an explicit offset ({@code Z} or {@code ±hh:mm}); empty for anything else,
   * including a local time without offset.
   */
  public static Optional<PickupTime> parse(String text) {
    if (text == null) return Optional.empty();
    try {
      return Optional.of(
          new PickupTime(
              OffsetDateTime.parse(text, DateTimeFormatter.ISO_OFFSET_DATE_TIME).toInstant()));
    } catch (DateTimeParseException malformed) {
      return Optional.empty();
    }
  }

  /** Later than {@code now} and within the same business day in America/Bogota. */
  public boolean isValidAt(Instant now) {
    Objects.requireNonNull(now);
    return value.isAfter(now) && BusinessDate.from(value).equals(BusinessDate.from(now));
  }
}

package com.santotofood.application.model;

import com.santotofood.domain.model.BusinessDate;
import java.time.Instant;
import java.time.LocalDate;

public record AdminDashboardPeriod(
    AdminDashboardRequest.Range range,
    LocalDate from,
    LocalDate to,
    String timezone,
    Instant startInclusive,
    Instant calendarEndExclusive,
    Instant endExclusive,
    Instant asOf,
    boolean partial) {
  public static AdminDashboardPeriod resolve(AdminDashboardRequest request, Instant now) {
    LocalDate today = BusinessDate.from(now).value();
    LocalDate to = request.range() == AdminDashboardRequest.Range.CUSTOM ? request.to() : today;
    LocalDate from =
        switch (request.range()) {
          case TODAY -> today;
          case LAST_7_DAYS -> today.minusDays(6);
          case LAST_30_DAYS -> today.minusDays(29);
          case CUSTOM -> request.from();
        };
    if (to.isAfter(today)) throw AdminDashboardRequest.invalid();
    Instant start = new BusinessDate(from).dayStartInstant();
    Instant calendarEnd = new BusinessDate(to).nextDayStartInstant();
    boolean partial = now.isBefore(calendarEnd);
    return new AdminDashboardPeriod(
        request.range(),
        from,
        to,
        "America/Bogota",
        start,
        calendarEnd,
        partial ? now : calendarEnd,
        now,
        partial);
  }
}

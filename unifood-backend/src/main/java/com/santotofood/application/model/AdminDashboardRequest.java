package com.santotofood.application.model;

import com.santotofood.application.exception.AdminDashboardException;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.time.format.ResolverStyle;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.Set;

public record AdminDashboardRequest(Range range, LocalDate from, LocalDate to, int rankingLimit) {
  public enum Range {
    TODAY,
    LAST_7_DAYS,
    LAST_30_DAYS,
    CUSTOM
  }

  public AdminDashboardRequest {
    if (range == null || rankingLimit < 1 || rankingLimit > 50) throw invalid();
    if (range == Range.CUSTOM) {
      if (from == null
          || to == null
          || from.isAfter(to)
          || ChronoUnit.DAYS.between(from, to) >= 366) throw invalid();
    } else if (from != null || to != null) throw invalid();
  }

  public static AdminDashboardRequest parse(Map<String, List<String>> parameters) {
    var allowed = Set.of("range", "from", "to", "rankingLimit");
    if (parameters.entrySet().stream()
        .anyMatch(
            e ->
                !allowed.contains(e.getKey())
                    || e.getValue() == null
                    || e.getValue().size() != 1
                    || e.getValue().getFirst() == null
                    || e.getValue().getFirst().isBlank())) throw invalid();
    try {
      String limit = first(parameters, "rankingLimit");
      if (limit != null && !limit.matches("[1-9][0-9]?")) throw invalid();
      return new AdminDashboardRequest(
          Range.valueOf(first(parameters, "range")),
          date(first(parameters, "from")),
          date(first(parameters, "to")),
          limit == null ? 10 : Integer.parseInt(limit));
    } catch (IllegalArgumentException
        | NullPointerException
        | java.time.DateTimeException exception) {
      throw invalid();
    }
  }

  private static String first(Map<String, List<String>> values, String key) {
    return values.containsKey(key) ? values.get(key).getFirst() : null;
  }

  private static LocalDate date(String text) {
    if (text == null) return null;
    if (!text.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}")) throw invalid();
    return LocalDate.parse(
        text, DateTimeFormatter.ofPattern("uuuu-MM-dd").withResolverStyle(ResolverStyle.STRICT));
  }

  public static AdminDashboardException invalid() {
    return new AdminDashboardException(AdminDashboardException.Reason.INVALID_REQUEST);
  }
}

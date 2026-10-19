package com.santotofood.application.model;

import com.santotofood.application.exception.InvalidWorkerHistoryRequestException;
import com.santotofood.domain.model.OrderStatus;
import java.text.Normalizer;
import java.util.Locale;

/** Validated criteria; identity and business dates are always backend facts. */
public record WorkerHistoryRequest(
    String query, Range range, OrderStatus status, String cursor, int limit) {
  public enum Range {
    TODAY,
    WEEK,
    MONTH
  }

  public WorkerHistoryRequest {
    if (query == null) query = "";
    if (query.length() > 120
        || query
            .codePoints()
            .anyMatch(c -> Character.isISOControl(c) && !Character.isWhitespace(c)))
      throw new InvalidWorkerHistoryRequestException();
    query = normalize(query);
    if (range == null || limit < 1 || limit > 100 || (cursor != null && cursor.length() > 512))
      throw new InvalidWorkerHistoryRequestException();
    if (status != null
        && status != OrderStatus.DELIVERED
        && status != OrderStatus.NOT_COLLECTED
        && status != OrderStatus.CANCELLED) throw new InvalidWorkerHistoryRequestException();
  }

  public static WorkerHistoryRequest parse(
      String query, String range, String status, String cursor, String limit) {
    try {
      return new WorkerHistoryRequest(
          query,
          range == null ? Range.MONTH : Range.valueOf(range),
          status == null ? null : OrderStatus.valueOf(status),
          cursor,
          limit == null ? 30 : Integer.parseInt(limit));
    } catch (IllegalArgumentException invalid) {
      throw new InvalidWorkerHistoryRequestException();
    }
  }

  public static String normalize(String value) {
    return Normalizer.normalize(value, Normalizer.Form.NFD)
        .replaceAll("\\p{M}", "")
        .toLowerCase(Locale.ROOT)
        .strip()
        .replaceAll("\\s+", " ");
  }
}

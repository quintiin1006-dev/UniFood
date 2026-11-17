package com.santotofood.adapter.in.web.dto;

import com.santotofood.application.exception.CashException;
import com.santotofood.application.model.CashSession;
import com.santotofood.application.model.CashViews;
import com.santotofood.domain.model.CashCount;
import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.http.MediaType;
import tools.jackson.core.StreamReadFeature;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.json.JsonMapper;

/**
 * Strict, bounded JSON decoding for the cash register commands: exact keys, integer amounts in
 * whole pesos (1000.0, "1000" or 1e3 are rejected) and never a cafeteria id.
 */
public final class CashRequests {
  public static final int MAX_BYTES = 4096;
  private static final JsonMapper JSON =
      JsonMapper.builder()
          .enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION)
          .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
          .build();
  private static final String UUID_PATTERN = "(?i)[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}";

  private CashRequests() {}

  public record Open(CashSession.Shift shift, long openingFloat) {}

  public record Movement(
      UUID requestId, CashViews.Movement.Kind kind, long amount, String reason) {}

  public record Close(
      CashCount count, String note, long expectedCash, int expectedVersion, boolean force) {}

  public record Reopen(String reason, int expectedVersion) {}

  public record Tolerance(int toleranceCop, int expectedVersion) {}

  public static UUID id(String value) {
    if (value == null || !value.matches(UUID_PATTERN)) throw CashException.notFound();
    return UUID.fromString(value);
  }

  public static UUID optionalCafeteria(String value) {
    if (value == null) return null;
    if (!value.matches(UUID_PATTERN)) throw CashException.invalidRequest();
    return UUID.fromString(value);
  }

  public static LocalDate date(String value) {
    if (value == null || !value.matches("\\d{4}-\\d{2}-\\d{2}")) throw CashException.invalidRange();
    try {
      return LocalDate.parse(value);
    } catch (DateTimeParseException exception) {
      throw CashException.invalidRange();
    }
  }

  private static Map<?, ?> body(
      HttpServletRequest request, Set<String> required, Set<String> optional) {
    try {
      if (request.getContentType() == null
          || !MediaType.APPLICATION_JSON.isCompatibleWith(
              MediaType.parseMediaType(request.getContentType()))
          || request.getContentLengthLong() > MAX_BYTES) throw CashException.invalidRequest();
      byte[] bytes = request.getInputStream().readNBytes(MAX_BYTES + 1);
      if (bytes.length > MAX_BYTES) throw CashException.invalidRequest();
      Object raw = JSON.readValue(bytes, Object.class);
      if (!(raw instanceof Map<?, ?> values)
          || !values.keySet().containsAll(required)
          || !values.keySet().stream()
              .allMatch(key -> required.contains(key) || optional.contains(key)))
        throw CashException.invalidRequest();
      return values;
    } catch (CashException exception) {
      throw exception;
    } catch (IOException | RuntimeException exception) {
      throw CashException.invalidRequest();
    }
  }

  /** Whole pesos: a JSON integer, never a decimal or a string. */
  private static long pesos(Object value) {
    if (value instanceof Integer amount) return amount;
    if (value instanceof Long amount) return amount;
    throw CashException.invalidAmount();
  }

  private static int integer(Object value) {
    if (value instanceof Integer number) return number;
    throw CashException.invalidRequest();
  }

  private static String text(Object value) {
    if (value == null) return null;
    if (value instanceof String text) return text;
    throw CashException.invalidRequest();
  }

  private static <E extends Enum<E>> E choice(Class<E> type, Object value) {
    if (!(value instanceof String name)) throw CashException.invalidRequest();
    try {
      return Enum.valueOf(type, name);
    } catch (IllegalArgumentException exception) {
      throw CashException.invalidRequest();
    }
  }

  /** [{denomination, quantity}] with known denominations, no repeats, quantities 0 to 10.000. */
  private static CashCount count(Object value) {
    if (!(value instanceof List<?> lines) || lines.size() > CashCount.DENOMINATIONS.size())
      throw CashException.invalidRequest();
    Map<Integer, Integer> quantities = new HashMap<>();
    for (Object line : lines) {
      if (!(line instanceof Map<?, ?> fields)
          || !fields.keySet().equals(Set.of("denomination", "quantity")))
        throw CashException.invalidRequest();
      int denomination = integer(fields.get("denomination"));
      int quantity = integer(fields.get("quantity"));
      if (quantities.put(denomination, quantity) != null) throw CashException.invalidRequest();
    }
    try {
      return CashCount.of(quantities);
    } catch (IllegalArgumentException exception) {
      throw CashException.invalidRequest();
    }
  }

  public static Open open(HttpServletRequest request) {
    var values = body(request, Set.of("shift", "openingFloat"), Set.of());
    return new Open(
        choice(CashSession.Shift.class, values.get("shift")), pesos(values.get("openingFloat")));
  }

  public static Movement movement(HttpServletRequest request) {
    var values = body(request, Set.of("requestId", "kind", "amount", "reason"), Set.of());
    String requestId = text(values.get("requestId"));
    if (requestId == null || !requestId.matches(UUID_PATTERN)) throw CashException.invalidRequest();
    String reason = text(values.get("reason"));
    if (reason == null) throw CashException.reasonRequired();
    return new Movement(
        UUID.fromString(requestId),
        choice(CashViews.Movement.Kind.class, values.get("kind")),
        pesos(values.get("amount")),
        reason);
  }

  public static CashCount preview(HttpServletRequest request) {
    return count(body(request, Set.of("lines"), Set.of()).get("lines"));
  }

  public static Close close(HttpServletRequest request) {
    var values =
        body(request, Set.of("lines", "note", "expectedCash", "expectedVersion"), Set.of("force"));
    Object force = values.containsKey("force") ? values.get("force") : Boolean.FALSE;
    if (!(force instanceof Boolean forced)) throw CashException.invalidRequest();
    return new Close(
        count(values.get("lines")),
        text(values.get("note")),
        pesos(values.get("expectedCash")),
        integer(values.get("expectedVersion")),
        forced);
  }

  public static Reopen reopen(HttpServletRequest request) {
    var values = body(request, Set.of("reason", "expectedVersion"), Set.of());
    String reason = text(values.get("reason"));
    if (reason == null) throw CashException.reopenReasonRequired();
    return new Reopen(reason, integer(values.get("expectedVersion")));
  }

  public static Tolerance tolerance(HttpServletRequest request) {
    var values = body(request, Set.of("toleranceCop", "expectedVersion"), Set.of());
    if (!(values.get("toleranceCop") instanceof Integer tolerance))
      throw CashException.invalidAmount();
    return new Tolerance(tolerance, integer(values.get("expectedVersion")));
  }
}

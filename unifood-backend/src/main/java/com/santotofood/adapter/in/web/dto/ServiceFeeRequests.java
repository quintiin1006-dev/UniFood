package com.santotofood.adapter.in.web.dto;

import com.santotofood.application.exception.ServiceFeeException;
import com.santotofood.application.port.in.ManageServiceFeeUseCase;
import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.time.YearMonth;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.http.MediaType;
import tools.jackson.core.StreamReadFeature;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.json.JsonMapper;

/** Strict, bounded JSON and path decoding for the service fee commands (033). */
public final class ServiceFeeRequests {
  public static final int MAX_BYTES = 1024;
  private static final JsonMapper JSON =
      JsonMapper.builder()
          .enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION)
          .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
          .build();
  private static final Set<String> FEE_KEYS = Set.of("feeCop", "expectedVersion");

  private ServiceFeeRequests() {}

  /** {@code feeCop} null only for a cafeteria: back to the general fee. */
  public record Fee(Integer feeCop, int expectedVersion) {}

  public static UUID id(String value) {
    if (value == null || !value.matches("(?i)[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}"))
      throw ServiceFeeException.invalidRequest();
    return UUID.fromString(value);
  }

  /** {@code YYYY-MM}; the use case checks its range. */
  public static YearMonth month(String value) {
    if (value == null || !value.matches("\\d{4}-(0[1-9]|1[0-2])"))
      throw ServiceFeeException.invalidRequest();
    return YearMonth.parse(value);
  }

  /** Optional ?limit= of 1 to 100; 20 when absent. */
  public static int limit(String value) {
    if (value == null) return 20;
    if (!value.matches("[1-9][0-9]{0,2}")) throw ServiceFeeException.invalidRequest();
    int limit = Integer.parseInt(value);
    if (limit > ManageServiceFeeUseCase.MAX_AUDIT_LIMIT) throw ServiceFeeException.invalidRequest();
    return limit;
  }

  /** Exactly {@code feeCop} and {@code expectedVersion}; whole pesos only (300.0 is refused). */
  public static Fee fee(HttpServletRequest request, boolean allowNull) {
    var values = body(request);
    if (!values.keySet().equals(FEE_KEYS)) throw ServiceFeeException.invalidRequest();
    var fee = values.get("feeCop");
    if (!(values.get("expectedVersion") instanceof Integer version)
        || (fee == null ? !allowNull : !(fee instanceof Integer)))
      throw ServiceFeeException.invalidRequest();
    return new Fee((Integer) fee, version);
  }

  /** No body, {@code {}} or {@code {"note": "..."}}. */
  public static String note(HttpServletRequest request) {
    if (request.getContentType() == null && request.getContentLengthLong() <= 0) return null;
    var values = body(request);
    if (!Set.of("note").containsAll(values.keySet())) throw ServiceFeeException.invalidRequest();
    var note = values.get("note");
    if (note != null && !(note instanceof String)) throw ServiceFeeException.invalidRequest();
    return (String) note;
  }

  private static Map<?, ?> body(HttpServletRequest request) {
    try {
      if (request.getContentType() == null
          || !MediaType.APPLICATION_JSON.isCompatibleWith(
              MediaType.parseMediaType(request.getContentType()))
          || request.getContentLengthLong() > MAX_BYTES) throw ServiceFeeException.invalidRequest();
      byte[] bytes = request.getInputStream().readNBytes(MAX_BYTES + 1);
      if (bytes.length > MAX_BYTES) throw ServiceFeeException.invalidRequest();
      if (!(JSON.readValue(bytes, Object.class) instanceof Map<?, ?> values))
        throw ServiceFeeException.invalidRequest();
      return values;
    } catch (IOException | RuntimeException exception) {
      throw ServiceFeeException.invalidRequest();
    }
  }
}

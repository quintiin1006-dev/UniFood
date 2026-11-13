package com.santotofood.adapter.in.web.dto;

import com.santotofood.application.exception.CafeteriaSettingsException;
import com.santotofood.application.model.CafeteriaBilling;
import com.santotofood.application.port.in.ListCafeteriaSettingsAuditUseCase;
import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Supplier;
import org.springframework.http.MediaType;
import tools.jackson.core.StreamReadFeature;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.json.JsonMapper;

/** Strict, bounded JSON decoding for the SUPER_ADMIN visibility and billing commands. */
public final class SuperAdminCafeteriaRequests {
  public static final int MAX_BYTES = 1024;
  private static final JsonMapper JSON =
      JsonMapper.builder()
          .enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION)
          .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
          .build();
  private static final Set<String> VISIBILITY_KEYS = Set.of("visible", "expectedVisible");
  private static final Set<String> BILLING_KEYS =
      Set.of("model", "perOrderFeeCop", "subscriptionFeeCop", "expectedVersion");

  private SuperAdminCafeteriaRequests() {}

  public record Visibility(boolean visible, boolean expectedVisible) {}

  public record Billing(CafeteriaBilling billing, int expectedVersion) {}

  public static UUID id(String value) {
    if (value == null || !value.matches("(?i)[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}"))
      throw CafeteriaSettingsException.invalidRequest();
    return UUID.fromString(value);
  }

  /** Optional ?limit= of 1 to 50 digits-only; 20 when absent. */
  public static int limit(String value) {
    if (value == null) return ListCafeteriaSettingsAuditUseCase.DEFAULT_LIMIT;
    if (!value.matches("[1-9][0-9]?")) throw CafeteriaSettingsException.invalidRequest();
    int limit = Integer.parseInt(value);
    if (limit > ListCafeteriaSettingsAuditUseCase.MAX_LIMIT)
      throw CafeteriaSettingsException.invalidRequest();
    return limit;
  }

  /** Exactly these keys, all present; anything else is the endpoint's 400. */
  private static Map<?, ?> body(
      HttpServletRequest request, Set<String> keys, Supplier<CafeteriaSettingsException> invalid) {
    try {
      if (request.getContentType() == null
          || !MediaType.APPLICATION_JSON.isCompatibleWith(
              MediaType.parseMediaType(request.getContentType()))
          || request.getContentLengthLong() > MAX_BYTES) throw invalid.get();
      byte[] bytes = request.getInputStream().readNBytes(MAX_BYTES + 1);
      if (bytes.length > MAX_BYTES) throw invalid.get();
      Object raw = JSON.readValue(bytes, Object.class);
      if (!(raw instanceof Map<?, ?> values) || !values.keySet().equals(keys)) throw invalid.get();
      return values;
    } catch (IOException | RuntimeException exception) {
      throw invalid.get();
    }
  }

  public static Visibility visibility(HttpServletRequest request) {
    var values = body(request, VISIBILITY_KEYS, CafeteriaSettingsException::invalidRequest);
    if (!(values.get("visible") instanceof Boolean visible)
        || !(values.get("expectedVisible") instanceof Boolean expected))
      throw CafeteriaSettingsException.invalidRequest();
    return new Visibility(visible, expected);
  }

  /** Whole pesos only: 1000.0, "1000" or 1e3 are not integers here. */
  private static Integer pesos(Object value) {
    if (value == null) return null;
    if (value instanceof Integer amount) return amount;
    throw CafeteriaSettingsException.invalidBilling();
  }

  public static Billing billing(HttpServletRequest request) {
    var values = body(request, BILLING_KEYS, CafeteriaSettingsException::invalidBilling);
    if (!(values.get("model") instanceof String model)
        || !(values.get("expectedVersion") instanceof Integer version)
        || version < 0) throw CafeteriaSettingsException.invalidBilling();
    CafeteriaBilling.Model parsed;
    try {
      parsed = CafeteriaBilling.Model.valueOf(model);
    } catch (IllegalArgumentException exception) {
      throw CafeteriaSettingsException.invalidBilling();
    }
    return new Billing(
        new CafeteriaBilling(
            parsed, pesos(values.get("perOrderFeeCop")), pesos(values.get("subscriptionFeeCop"))),
        version);
  }
}

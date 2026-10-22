package com.santotofood.adapter.in.web.dto;

import static com.santotofood.application.exception.AdminCatalogCommandException.Reason.INVALID_REQUEST;

import com.santotofood.application.exception.AdminCatalogCommandException;
import com.santotofood.application.model.CatalogForm;
import com.santotofood.domain.model.CatalogCategory;
import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.math.BigDecimal;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.http.MediaType;
import tools.jackson.core.StreamReadFeature;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.json.JsonMapper;

/** Bounded, strict JSON DTO decoding scoped to catalog commands only. */
public final class AdminCatalogRequests {
  public static final int MAX_BYTES = 16384;
  private static final JsonMapper JSON =
      JsonMapper.builder()
          .enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION)
          .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
          .build();

  private AdminCatalogRequests() {}

  public record Edit(CatalogForm form, long expectedVersion) {}

  public record Status(boolean active, long expectedVersion) {}

  public static UUID id(String value) {
    if (value == null || !value.matches("(?i)[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}"))
      throw invalid();
    return UUID.fromString(value);
  }

  private static AdminCatalogCommandException invalid() {
    return new AdminCatalogCommandException(INVALID_REQUEST);
  }

  private static Map<?, ?> body(
      HttpServletRequest request, Set<String> allowed, Set<String> required) {
    try {
      if (request.getContentType() == null
          || !MediaType.APPLICATION_JSON.isCompatibleWith(
              MediaType.parseMediaType(request.getContentType()))
          || request.getContentLengthLong() > MAX_BYTES) throw invalid();
      byte[] bytes = request.getInputStream().readNBytes(MAX_BYTES + 1);
      if (bytes.length > MAX_BYTES) throw invalid();
      Object raw = JSON.readValue(bytes, Object.class);
      if (!(raw instanceof Map<?, ?> values)
          || !allowed.containsAll(values.keySet())
          || !values.keySet().containsAll(required)) throw invalid();
      return values;
    } catch (IOException | RuntimeException e) {
      throw invalid();
    }
  }

  private static CatalogForm form(Map<?, ?> values) {
    try {
      if (!(values.get("name") instanceof String name)
          || !(values.get("price") instanceof String price)
          || !price.matches("(?:0|[1-9][0-9]{0,9})(?:\\.[0-9]{1,2})?")
          || !(values.get("category") instanceof String category)
          || (values.get("description") != null && !(values.get("description") instanceof String)))
        throw invalid();
      return new CatalogForm(
          name,
          (String) values.get("description"),
          new BigDecimal(price),
          CatalogCategory.valueOf(category));
    } catch (IllegalArgumentException e) {
      throw invalid();
    }
  }

  private static long version(Map<?, ?> values) {
    try {
      if (!(values.get("expectedVersion") instanceof String value)
          || !value.matches("0|[1-9][0-9]{0,18}")) throw invalid();
      return Long.parseLong(value);
    } catch (NumberFormatException e) {
      throw invalid();
    }
  }

  public static CatalogForm create(HttpServletRequest request) {
    return form(
        body(
            request,
            Set.of("name", "description", "price", "category"),
            Set.of("name", "price", "category")));
  }

  public static Edit edit(HttpServletRequest request) {
    var values =
        body(
            request,
            Set.of("name", "description", "price", "category", "expectedVersion"),
            Set.of("name", "description", "price", "category", "expectedVersion"));
    return new Edit(form(values), version(values));
  }

  public static Status status(HttpServletRequest request) {
    var values =
        body(request, Set.of("active", "expectedVersion"), Set.of("active", "expectedVersion"));
    if (!(values.get("active") instanceof Boolean active)) throw invalid();
    return new Status(active, version(values));
  }
}

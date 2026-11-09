package com.santotofood.adapter.in.web.dto;

import com.santotofood.application.port.in.CreateOwnOrderUseCase.Line;
import com.santotofood.application.port.in.CreateOwnOrderUseCase.OrderRequest;
import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.MediaType;
import tools.jackson.core.StreamReadFeature;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.json.JsonMapper;

/**
 * Bounded decoding of the create-order body (docs/decisiones.md §11). Only {@code cafeteriaId},
 * {@code items[].productId}, {@code items[].quantity} and {@code note} are read: prices, totals or
 * any other field the browser sends are ignored, never trusted.
 */
public final class ClientOrderRequests {
  public static final int MAX_BYTES = 8192;
  private static final String UUID_FORMAT = "(?i)[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}";
  private static final JsonMapper JSON =
      JsonMapper.builder()
          .enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION)
          .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
          .build();

  private ClientOrderRequests() {}

  /** The request, or {@code null} when it is unreadable: the use case answers 400 for it. */
  public static OrderRequest read(HttpServletRequest request) {
    try {
      if (request.getContentType() == null
          || !MediaType.APPLICATION_JSON.isCompatibleWith(
              MediaType.parseMediaType(request.getContentType()))
          || request.getContentLengthLong() > MAX_BYTES) return null;
      byte[] bytes = request.getInputStream().readNBytes(MAX_BYTES + 1);
      if (bytes.length > MAX_BYTES) return null;
      if (!(JSON.readValue(bytes, Object.class) instanceof Map<?, ?> body)) return null;
      if (!(body.get("items") instanceof List<?> rawItems)) return null;
      var items = new ArrayList<Line>();
      for (Object raw : rawItems) {
        if (!(raw instanceof Map<?, ?> item) || !(item.get("quantity") instanceof Integer quantity))
          return null;
        var productId = uuid(item.get("productId"));
        if (productId == null) return null;
        items.add(new Line(productId, quantity));
      }
      var note = body.get("note");
      if (note != null && !(note instanceof String)) return null;
      var cafeteriaId = uuid(body.get("cafeteriaId"));
      if (cafeteriaId == null) return null;
      return new OrderRequest(cafeteriaId, List.copyOf(items), (String) note);
    } catch (IOException | RuntimeException unreadable) {
      return null;
    }
  }

  private static UUID uuid(Object value) {
    return value instanceof String text && text.matches(UUID_FORMAT) ? UUID.fromString(text) : null;
  }
}

package com.santotofood.adapter.in.web.dto;

import com.santotofood.application.port.in.CreateOwnOrderUseCase.Choice;
import com.santotofood.application.port.in.CreateOwnOrderUseCase.DailyMenuRequest;
import com.santotofood.application.port.in.CreateOwnOrderUseCase.Line;
import com.santotofood.application.port.in.CreateOwnOrderUseCase.OrderRequest;
import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.time.LocalDate;
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
 * {@code items[].productId}, {@code items[].quantity}, {@code note}, {@code requestedPickupAt} and
 * {@code dailyMenu} ({@code businessDate}, {@code choices[].categoryId}, {@code
 * choices[].optionId}, {@code choices[].skip} and {@code additionIds},
 * docs/propuesta-menu-dinamico.md section 3.2) and {@code expectedServiceFee} (whole pesos the
 * client was shown, docs/modelo-de-negocio.md) are read: prices, totals or any other field the
 * browser sends are ignored, never trusted.
 */
public final class ClientOrderRequests {
  public static final int MAX_BYTES = 8192;
  private static final String UUID_FORMAT = "(?i)[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}";
  private static final String DATE_FORMAT = "\\d{4}-\\d{2}-\\d{2}";
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
      // Optional; only a string reaches the use case, which owns its format and range.
      var pickup = body.get("requestedPickupAt");
      if (pickup != null && !(pickup instanceof String)) return null;
      var cafeteriaId = uuid(body.get("cafeteriaId"));
      if (cafeteriaId == null) return null;
      DailyMenuRequest dailyMenu = null;
      if (body.get("dailyMenu") != null) {
        dailyMenu = dailyMenu(body.get("dailyMenu"));
        if (dailyMenu == null) return null;
      }
      // Optional; only an integer reaches the use case, which owns its range.
      var expectedFee = body.get("expectedServiceFee");
      if (expectedFee != null && !(expectedFee instanceof Integer)) return null;
      return new OrderRequest(
          cafeteriaId,
          List.copyOf(items),
          (String) note,
          (String) pickup,
          dailyMenu,
          (Integer) expectedFee);
    } catch (IOException | RuntimeException unreadable) {
      return null;
    }
  }

  /** The plate as sent, or null when its shape is wrong; the use case owns every rule. */
  private static DailyMenuRequest dailyMenu(Object raw) {
    if (!(raw instanceof Map<?, ?> menu)
        || !(menu.get("businessDate") instanceof String date)
        || !date.matches(DATE_FORMAT)
        || !(menu.get("choices") instanceof List<?> rawChoices)) return null;
    var businessDate = LocalDate.parse(date);
    var choices = new ArrayList<Choice>();
    for (Object rawChoice : rawChoices) {
      if (!(rawChoice instanceof Map<?, ?> choice)) return null;
      var categoryId = uuid(choice.get("categoryId"));
      if (categoryId == null) return null;
      UUID optionId = null;
      if (choice.get("optionId") != null) {
        optionId = uuid(choice.get("optionId"));
        if (optionId == null) return null;
      }
      var skip = choice.get("skip");
      if (skip != null && !(skip instanceof Boolean)) return null;
      choices.add(new Choice(categoryId, optionId, Boolean.TRUE.equals(skip)));
    }
    var additions = new ArrayList<UUID>();
    var rawAdditions = menu.get("additionIds");
    if (rawAdditions != null) {
      if (!(rawAdditions instanceof List<?> list)) return null;
      for (Object rawAddition : list) {
        var additionId = uuid(rawAddition);
        if (additionId == null) return null;
        additions.add(additionId);
      }
    }
    return new DailyMenuRequest(businessDate, List.copyOf(choices), List.copyOf(additions));
  }

  private static UUID uuid(Object value) {
    return value instanceof String text && text.matches(UUID_FORMAT) ? UUID.fromString(text) : null;
  }
}

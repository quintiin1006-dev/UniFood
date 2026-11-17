package com.santotofood.adapter.out.push;

import com.santotofood.domain.model.OrderPushEvent;
import java.util.Locale;
import java.util.UUID;

/**
 * The minimal, personal-data-free payload the service worker shows: title, short body, a tag per
 * order (a new notice replaces the previous one instead of stacking) and the page to open.
 *
 * <p>{@code topic} is kept but NOT sent: Apple answers 400 BadWebPushTopic to values that meet the
 * RFC, so the Topic header is omitted (experiment). Replacement of the notices of one order is done
 * by the client through {@code tag}.
 */
public record PushMessage(
    String title, String body, String tag, String url, String topic, boolean urgent) {

  public static final String CLIENT_URL = "/cuenta/pedido";
  public static final String WORKER_URL = "/worker";

  public static PushMessage of(OrderPushEvent event) {
    String compact = event.orderId().toString().replace("-", "");
    String reference = reference(event.orderId());
    return switch (event.kind()) {
      case NEW_ORDER ->
          new PushMessage(
              "Nuevo pedido #" + reference,
              "Revisa el tablero de pedidos.",
              "unifood-new-" + reference,
              WORKER_URL,
              "n" + compact.substring(0, 24),
              true);
      case PREPARING ->
          client(
              "Tu pedido está en preparación",
              "Te avisaremos cuando esté listo.",
              reference,
              compact,
              false);
      case READY ->
          client(
              "¡Tu pedido está listo!",
              "Pronto te llamarán para recogerlo.",
              reference,
              compact,
              true);
      case CALLED ->
          client(
              "Te están llamando, pasa a recoger",
              "Tu pedido te espera en la cafetería.",
              reference,
              compact,
              true);
      case REMINDER ->
          client(
              "Recuerda recoger tu pedido",
              "Tu pedido sigue esperándote en la cafetería.",
              reference,
              compact,
              true);
      case REJECTED ->
          client(
              "La cafetería no pudo aceptar tu pedido",
              "Abre UniFood para ver el motivo.",
              reference,
              compact,
              false);
      case NOT_COLLECTED ->
          client(
              "Tu pedido no fue recogido",
              "Abre UniFood para ver el detalle.",
              reference,
              compact,
              false);
    };
  }

  /** The same 8-character reference the client sees after checkout (CheckoutConfirmation). */
  public static String reference(UUID orderId) {
    return orderId.toString().replace("-", "").substring(0, 8).toUpperCase(Locale.ROOT);
  }

  private static PushMessage client(
      String title, String body, String reference, String compact, boolean urgent) {
    return new PushMessage(
        title,
        body,
        "unifood-order-" + reference,
        CLIENT_URL,
        "o" + compact.substring(0, 24),
        urgent);
  }

  public String json() {
    return "{\"title\":"
        + quote(title)
        + ",\"body\":"
        + quote(body)
        + ",\"tag\":"
        + quote(tag)
        + ",\"url\":"
        + quote(url)
        + "}";
  }

  private static String quote(String value) {
    var out = new StringBuilder(value.length() + 2).append('"');
    for (char c : value.toCharArray()) {
      switch (c) {
        case '"' -> out.append("\\\"");
        case '\\' -> out.append("\\\\");
        default -> {
          if (c < 0x20) out.append(String.format("\\u%04x", (int) c));
          else out.append(c);
        }
      }
    }
    return out.append('"').toString();
  }
}

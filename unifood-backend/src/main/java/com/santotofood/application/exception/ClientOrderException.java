package com.santotofood.application.exception;

import com.santotofood.shared.error.ErrorCode;
import java.util.UUID;

/**
 * Client order refusals with fixed Spanish messages (docs/decisiones.md §11). They never say
 * whether another institution's cafeteria or product exists, which product failed, or whether
 * another client's order exists.
 */
public class ClientOrderException extends RuntimeException {
  public enum Kind {
    FORBIDDEN,
    BAD_REQUEST,
    NOT_FOUND,
    CONFLICT,
    UNAVAILABLE
  }

  private final Kind kind;
  private final String code;
  private final UUID activeOrderId;

  private ClientOrderException(Kind kind, String code, String message, UUID activeOrderId) {
    super(message, null, false, false);
    this.kind = kind;
    this.code = code;
    this.activeOrderId = activeOrderId;
  }

  private static ClientOrderException of(Kind kind, ErrorCode code, String message) {
    return new ClientOrderException(kind, code.name(), message, null);
  }

  /** Same code as the guard: an inactive account and a missing client row look alike. */
  public static ClientOrderException forbidden() {
    return new ClientOrderException(
        Kind.FORBIDDEN, "FORBIDDEN", "No tienes permisos para crear pedidos.", null);
  }

  public static ClientOrderException invalidRequest() {
    return of(Kind.BAD_REQUEST, ErrorCode.INVALID_ORDER_REQUEST, "El pedido no es válido.");
  }

  public static ClientOrderException limitExceeded() {
    return of(
        Kind.BAD_REQUEST,
        ErrorCode.ORDER_LIMIT_EXCEEDED,
        "Un pedido admite hasta 10 unidades por producto y 15 en total.");
  }

  public static ClientOrderException noteTooLong() {
    return of(
        Kind.BAD_REQUEST, ErrorCode.ORDER_NOTE_TOO_LONG, "La nota admite hasta 200 caracteres.");
  }

  /** Malformed, without offset, already past or outside today's business day in Bogotá. */
  public static ClientOrderException invalidPickupTime() {
    return of(
        Kind.BAD_REQUEST,
        ErrorCode.INVALID_PICKUP_TIME,
        "La hora de recogida debe ser más tarde el día de hoy.");
  }

  public static ClientOrderException cafeteriaNotFound() {
    return of(Kind.NOT_FOUND, ErrorCode.CAFETERIA_NOT_FOUND, "No encontramos esa cafetería.");
  }

  public static ClientOrderException cafeteriaNotSubscribed() {
    return of(
        Kind.FORBIDDEN,
        ErrorCode.CAFETERIA_NOT_SUBSCRIBED,
        "Esta cafetería no está disponible en este momento.");
  }

  public static ClientOrderException cafeteriaClosed() {
    return of(
        Kind.CONFLICT, ErrorCode.CAFETERIA_CLOSED, "La cafetería está cerrada en este momento.");
  }

  public static ClientOrderException productUnavailable() {
    return of(
        Kind.CONFLICT,
        ErrorCode.PRODUCT_UNAVAILABLE,
        "Uno de los productos ya no está disponible. Actualiza tu carrito.");
  }

  public static ClientOrderException activeOrderExists(UUID activeOrderId) {
    return new ClientOrderException(
        Kind.CONFLICT,
        ErrorCode.ACTIVE_ORDER_EXISTS.name(),
        "Ya tienes un pedido en curso.",
        activeOrderId);
  }

  public static ClientOrderException idempotencyKeyConflict() {
    return of(
        Kind.CONFLICT,
        ErrorCode.IDEMPOTENCY_KEY_CONFLICT,
        "Esta solicitud ya se usó para otro pedido.");
  }

  public static ClientOrderException temporarilyUnavailable() {
    return of(
        Kind.UNAVAILABLE,
        ErrorCode.ORDER_TEMPORARILY_UNAVAILABLE,
        "No pudimos crear tu pedido en este momento. Inténtalo nuevamente.");
  }

  public static ClientOrderException readForbidden() {
    return new ClientOrderException(
        Kind.FORBIDDEN, "FORBIDDEN", "No tienes permisos para ver pedidos.", null);
  }

  /** Same message whether the order belongs to someone else or does not exist. */
  public static ClientOrderException orderNotFound() {
    return of(Kind.NOT_FOUND, ErrorCode.ORDER_NOT_FOUND, "No encontramos ese pedido.");
  }

  public static ClientOrderException readUnavailable() {
    return of(
        Kind.UNAVAILABLE,
        ErrorCode.ORDER_TEMPORARILY_UNAVAILABLE,
        "No pudimos cargar tus pedidos en este momento. Inténtalo nuevamente.");
  }

  public Kind getKind() {
    return kind;
  }

  public String getCode() {
    return code;
  }

  /** Only for ACTIVE_ORDER_EXISTS: the order the client must pick up or cancel first. */
  public UUID getActiveOrderId() {
    return activeOrderId;
  }
}

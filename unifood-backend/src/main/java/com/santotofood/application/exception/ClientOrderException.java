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
  private final Integer serviceFee;

  private ClientOrderException(Kind kind, String code, String message, UUID activeOrderId) {
    this(kind, code, message, activeOrderId, null);
  }

  private ClientOrderException(
      Kind kind, String code, String message, UUID activeOrderId, Integer serviceFee) {
    super(message, null, false, false);
    this.kind = kind;
    this.code = code;
    this.activeOrderId = activeOrderId;
    this.serviceFee = serviceFee;
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

  /** MENU_DINAMICO_ENABLED is off and the order carries a daily menu. */
  public static ClientOrderException dailyMenuDisabled() {
    return of(
        Kind.CONFLICT,
        ErrorCode.DAILY_MENU_DISABLED,
        "El menú del día no está disponible por ahora.");
  }

  /** Not published, incomplete or no menu today: the order is not created. */
  public static ClientOrderException dailyMenuNotPublished() {
    return of(
        Kind.CONFLICT,
        ErrorCode.DAILY_MENU_NOT_PUBLISHED,
        "Hoy todavía no hay menú del día publicado.");
  }

  /** The client saw another business date than the server's. */
  public static ClientOrderException dailyMenuDateChanged() {
    return of(
        Kind.CONFLICT,
        ErrorCode.DAILY_MENU_DATE_CHANGED,
        "Cambió el día. Actualiza la pantalla para ver el menú de hoy.");
  }

  /**
   * A missing or repeated choice, an option of another category or «Ninguna» where it is not
   * allowed.
   */
  public static ClientOrderException dailyMenuSelectionInvalid() {
    return of(
        Kind.BAD_REQUEST,
        ErrorCode.DAILY_MENU_SELECTION_INVALID,
        "Revisa tu elección del menú del día: falta una opción o ya no está disponible.");
  }

  /** An addition that is off, inactive or not of this cafeteria today. */
  public static ClientOrderException dailyMenuAdditionUnavailable() {
    return of(
        Kind.CONFLICT,
        ErrorCode.DAILY_MENU_ADDITION_UNAVAILABLE,
        "Esa adición no está disponible.");
  }

  /**
   * The fee the client was shown is not the one in force (docs/modelo-de-negocio.md, rule 5). It
   * carries the current fee so the app can show it; nothing was written.
   */
  public static ClientOrderException serviceFeeChanged(int currentFee) {
    return new ClientOrderException(
        Kind.CONFLICT,
        ErrorCode.SERVICE_FEE_CHANGED.name(),
        "El cargo por servicio cambió. Revisa el total y confirma de nuevo.",
        null,
        currentFee);
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

  /** The fee in force, only for SERVICE_FEE_CHANGED. */
  public Integer getServiceFee() {
    return serviceFee;
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

package com.santotofood.application.exception;

import com.santotofood.application.model.CashViews;
import com.santotofood.shared.error.ErrorCode;
import java.time.LocalDate;
import java.util.List;

/** Fixed outcomes of the cash register endpoints, with Spanish messages for the panel. */
public class CashException extends RuntimeException {
  public enum Kind {
    BAD_REQUEST,
    FORBIDDEN,
    NOT_FOUND,
    CONFLICT
  }

  private final Kind kind;
  private final ErrorCode code;
  private final transient List<CashViews.PendingOrder> pendingOrders;
  private final transient CashViews.ClosePreview preview;

  private CashException(
      Kind kind,
      ErrorCode code,
      String message,
      List<CashViews.PendingOrder> pendingOrders,
      CashViews.ClosePreview preview) {
    super(message);
    this.kind = kind;
    this.code = code;
    this.pendingOrders = pendingOrders;
    this.preview = preview;
  }

  private static CashException of(Kind kind, ErrorCode code, String message) {
    return new CashException(kind, code, message, null, null);
  }

  public static CashException forbidden() {
    return of(Kind.FORBIDDEN, ErrorCode.CASH_FORBIDDEN, "No tienes permisos para operar la caja.");
  }

  public static CashException adminOnly() {
    return of(
        Kind.FORBIDDEN,
        ErrorCode.CASH_FORBIDDEN,
        "Solo el administrador de la cafetería puede hacer esto.");
  }

  public static CashException invalidRequest() {
    return of(
        Kind.BAD_REQUEST, ErrorCode.CASH_INVALID_REQUEST, "Revisa los datos e inténtalo de nuevo.");
  }

  public static CashException invalidAmount() {
    return of(
        Kind.BAD_REQUEST,
        ErrorCode.CASH_INVALID_AMOUNT,
        "Escribe un monto en pesos enteros, sin decimales.");
  }

  public static CashException reasonRequired() {
    return of(
        Kind.BAD_REQUEST,
        ErrorCode.CASH_REASON_REQUIRED,
        "Escribe el motivo del movimiento (de 3 a 200 caracteres).");
  }

  public static CashException noteRequired() {
    return of(
        Kind.BAD_REQUEST,
        ErrorCode.CASH_NOTE_REQUIRED,
        "La caja no cuadra: explica la diferencia en una nota de al menos 10 caracteres.");
  }

  public static CashException noteTooLong() {
    return of(
        Kind.BAD_REQUEST,
        ErrorCode.CASH_INVALID_REQUEST,
        "La nota puede tener hasta 500 caracteres.");
  }

  public static CashException reopenReasonRequired() {
    return of(
        Kind.BAD_REQUEST,
        ErrorCode.CASH_REOPEN_REASON_REQUIRED,
        "Escribe el motivo de la reapertura (de 10 a 300 caracteres).");
  }

  public static CashException invalidRange() {
    return of(
        Kind.BAD_REQUEST,
        ErrorCode.CASH_INVALID_REQUEST,
        "Elige un rango de fechas válido de hasta 92 días.");
  }

  public static CashException notFound() {
    return of(Kind.NOT_FOUND, ErrorCode.CASH_SESSION_NOT_FOUND, "No encontramos esa caja.");
  }

  public static CashException alreadyOpen() {
    return of(
        Kind.CONFLICT,
        ErrorCode.CASH_SESSION_ALREADY_OPEN,
        "Ya hay una caja abierta en esta cafetería. Ciérrala antes de abrir otra.");
  }

  public static CashException staleOpen(LocalDate date) {
    return of(
        Kind.CONFLICT,
        ErrorCode.CASH_STALE_SESSION_OPEN,
        "Quedó abierta la caja del "
            + date
            + ". Ciérrala antes de abrir la de hoy; el administrador ya fue avisado.");
  }

  public static CashException shiftUsed() {
    return of(
        Kind.CONFLICT,
        ErrorCode.CASH_SHIFT_ALREADY_USED,
        "La caja de este turno ya se cerró hoy. Si hace falta corregirla, pide al administrador"
            + " que la reabra.");
  }

  public static CashException sessionClosed() {
    return of(
        Kind.CONFLICT,
        ErrorCode.CASH_SESSION_CLOSED,
        "Esta caja ya está cerrada y no admite cambios.");
  }

  public static CashException stateChanged() {
    return of(
        Kind.CONFLICT,
        ErrorCode.CASH_STATE_CHANGED,
        "La caja cambió mientras la revisabas. Revisa las cifras actuales e inténtalo de nuevo.");
  }

  public static CashException expectedChanged(CashViews.ClosePreview preview) {
    return new CashException(
        Kind.CONFLICT,
        ErrorCode.CASH_EXPECTED_CHANGED,
        "Hubo ventas o movimientos nuevos mientras contabas. Revisa el esperado actualizado.",
        preview.pendingOrders(),
        preview);
  }

  public static CashException pendingOrders(List<CashViews.PendingOrder> orders) {
    return new CashException(
        Kind.CONFLICT,
        ErrorCode.CASH_PENDING_ORDERS,
        "Hay pedidos listos o llamados sin resolver. Entrégalos o márcalos como no recogidos"
            + " antes de cerrar la caja.",
        List.copyOf(orders),
        null);
  }

  public static CashException expenseExceedsBalance() {
    return of(
        Kind.CONFLICT,
        ErrorCode.CASH_EXPENSE_EXCEEDS_BALANCE,
        "El egreso supera el efectivo esperado en caja.");
  }

  public static CashException fractionalOrderTotal() {
    return of(
        Kind.CONFLICT,
        ErrorCode.CASH_ORDER_TOTAL_NOT_WHOLE,
        "Un pedido entregado tiene centavos en su total y la caja no puede cerrarse. Avisa al"
            + " administrador.");
  }

  public static CashException notClosed() {
    return of(
        Kind.CONFLICT,
        ErrorCode.CASH_SESSION_NOT_CLOSED,
        "Solo se puede reabrir una caja cerrada.");
  }

  public static CashException reopenNotLatest() {
    return of(
        Kind.CONFLICT,
        ErrorCode.CASH_REOPEN_NOT_LATEST,
        "Solo se puede reabrir la última caja cerrada de la cafetería.");
  }

  public static CashException reopenWithOpenDrawer() {
    return of(
        Kind.CONFLICT,
        ErrorCode.CASH_SESSION_ALREADY_OPEN,
        "Hay otra caja abierta en esta cafetería. Ciérrala antes de reabrir esta.");
  }

  public static CashException toleranceChanged() {
    return of(
        Kind.CONFLICT,
        ErrorCode.CASH_TOLERANCE_CHANGED,
        "Otra persona cambió la tolerancia. Revisa el valor actual e inténtalo de nuevo.");
  }

  public Kind kind() {
    return kind;
  }

  public ErrorCode code() {
    return code;
  }

  public List<CashViews.PendingOrder> pendingOrders() {
    return pendingOrders;
  }

  public CashViews.ClosePreview preview() {
    return preview;
  }
}

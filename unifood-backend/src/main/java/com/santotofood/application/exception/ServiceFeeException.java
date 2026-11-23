package com.santotofood.application.exception;

import com.santotofood.shared.error.ErrorCode;

/** Fixed outcomes of the service fee settings and settlement endpoints (033). */
public class ServiceFeeException extends RuntimeException {
  public enum Kind {
    BAD_REQUEST,
    FORBIDDEN,
    NOT_FOUND,
    CONFLICT,
    GONE
  }

  private final Kind kind;
  private final ErrorCode code;

  private ServiceFeeException(Kind kind, ErrorCode code, String message) {
    super(message, null, false, false);
    this.kind = kind;
    this.code = code;
  }

  /** SERVICE_FEE_ENABLED is off: the endpoints do not exist. */
  public static ServiceFeeException disabled() {
    return new ServiceFeeException(
        Kind.NOT_FOUND, ErrorCode.SERVICE_FEE_DISABLED, "Esta función no está disponible.");
  }

  public static ServiceFeeException invalidRequest() {
    return new ServiceFeeException(
        Kind.BAD_REQUEST,
        ErrorCode.SERVICE_FEE_INVALID_REQUEST,
        "Revisa el valor: debe ser un número entero de pesos entre 0 y 2.000.");
  }

  public static ServiceFeeException forbidden() {
    return new ServiceFeeException(
        Kind.FORBIDDEN,
        ErrorCode.SERVICE_FEE_FORBIDDEN,
        "No tienes permisos para ver el cargo por servicio.");
  }

  public static ServiceFeeException cafeteriaNotFound() {
    return new ServiceFeeException(
        Kind.NOT_FOUND, ErrorCode.CAFETERIA_NOT_FOUND, "No encontramos esa cafetería.");
  }

  public static ServiceFeeException stateChanged() {
    return new ServiceFeeException(
        Kind.CONFLICT,
        ErrorCode.SERVICE_FEE_STATE_CHANGED,
        "Otra persona cambió este valor. Revisa el valor actual e inténtalo de nuevo.");
  }

  public static ServiceFeeException monthOpen() {
    return new ServiceFeeException(
        Kind.CONFLICT,
        ErrorCode.SERVICE_FEE_MONTH_OPEN,
        "Este mes todavía no ha terminado. Podrás cerrarlo desde el primer día del mes siguiente.");
  }

  public static ServiceFeeException monthNotClosed() {
    return new ServiceFeeException(
        Kind.CONFLICT,
        ErrorCode.SERVICE_FEE_MONTH_NOT_CLOSED,
        "Cierra el mes antes de marcarlo como pagado.");
  }

  /** The 022 billing agreement is replaced by the service fee while SERVICE_FEE_ENABLED is on. */
  public static ServiceFeeException billingDeprecated() {
    return new ServiceFeeException(
        Kind.GONE,
        ErrorCode.BILLING_DEPRECATED,
        "El modelo de cobro fue reemplazado por el cargo por servicio.");
  }

  public Kind kind() {
    return kind;
  }

  public ErrorCode code() {
    return code;
  }
}

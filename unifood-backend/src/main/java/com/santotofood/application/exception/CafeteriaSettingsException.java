package com.santotofood.application.exception;

import com.santotofood.shared.error.ErrorCode;

/** Fixed outcomes of the SUPER_ADMIN visibility, billing and audit endpoints. */
public class CafeteriaSettingsException extends RuntimeException {
  public enum Kind {
    BAD_REQUEST,
    NOT_FOUND,
    CONFLICT
  }

  private final Kind kind;
  private final ErrorCode code;

  private CafeteriaSettingsException(Kind kind, ErrorCode code, String message) {
    super(message);
    this.kind = kind;
    this.code = code;
  }

  public static CafeteriaSettingsException invalidRequest() {
    return new CafeteriaSettingsException(
        Kind.BAD_REQUEST, ErrorCode.SUPER_ADMIN_INVALID_REQUEST, "La solicitud no es válida.");
  }

  public static CafeteriaSettingsException invalidBilling() {
    return new CafeteriaSettingsException(
        Kind.BAD_REQUEST,
        ErrorCode.BILLING_INVALID_REQUEST,
        "Revisa el modelo de cobro y sus montos en pesos enteros.");
  }

  public static CafeteriaSettingsException cafeteriaNotFound() {
    return new CafeteriaSettingsException(
        Kind.NOT_FOUND, ErrorCode.CAFETERIA_NOT_FOUND, "No encontramos esa cafetería.");
  }

  public static CafeteriaSettingsException visibilityChanged() {
    return new CafeteriaSettingsException(
        Kind.CONFLICT,
        ErrorCode.VISIBILITY_STATE_CHANGED,
        "Otra persona cambió esta cafetería. Revisa el valor actual e inténtalo de nuevo.");
  }

  public static CafeteriaSettingsException billingChanged() {
    return new CafeteriaSettingsException(
        Kind.CONFLICT,
        ErrorCode.BILLING_STATE_CHANGED,
        "Otra persona cambió esta cafetería. Revisa el valor actual e inténtalo de nuevo.");
  }

  public static CafeteriaSettingsException requiresAdmin() {
    return new CafeteriaSettingsException(
        Kind.CONFLICT,
        ErrorCode.CAFETERIA_REQUIRES_ADMIN,
        "Asigna un administrador activo antes de hacer visible esta cafetería.");
  }

  public Kind kind() {
    return kind;
  }

  public ErrorCode code() {
    return code;
  }
}

package com.santotofood.application.exception;

import com.santotofood.shared.error.ErrorCode;

/** Fixed public messages: they never reveal whether another institution's cafeteria exists. */
public class ClientCatalogException extends RuntimeException {
  private final ErrorCode code;

  private ClientCatalogException(ErrorCode code, String message) {
    super(message);
    this.code = code;
  }

  public static ClientCatalogException cafeteriaNotFound() {
    return new ClientCatalogException(
        ErrorCode.CAFETERIA_NOT_FOUND, "No encontramos esa cafetería.");
  }

  public static ClientCatalogException cafeteriaNotSubscribed() {
    return new ClientCatalogException(
        ErrorCode.CAFETERIA_NOT_SUBSCRIBED, "Esta cafetería no está disponible en este momento.");
  }

  public ErrorCode getCode() {
    return code;
  }
}

package com.santotofood.application.exception;

import com.santotofood.shared.error.ErrorCode;

public class ClientProfileNotFoundException extends RuntimeException {
  public ClientProfileNotFoundException() {
    super("No se encontró el perfil de tu cuenta.");
  }

  public ErrorCode getCode() {
    return ErrorCode.CLIENT_PROFILE_NOT_FOUND;
  }
}

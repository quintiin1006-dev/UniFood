package com.santotofood.domain.exception;

import com.santotofood.shared.error.ErrorCode;

/** The submitted cart breaks a rule that does not depend on current stock. Mapped to HTTP 400. */
public class InvalidOrderRequestException extends DomainException {

  public InvalidOrderRequestException(ErrorCode code, String message) {
    super(code, message);
  }
}

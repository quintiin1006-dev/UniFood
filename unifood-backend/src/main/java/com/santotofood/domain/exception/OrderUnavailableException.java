package com.santotofood.domain.exception;

import com.santotofood.shared.error.ErrorCode;

/** The cart is valid, but the current catalog or stock no longer allows it. Mapped to HTTP 409. */
public class OrderUnavailableException extends DomainException {

  public OrderUnavailableException(ErrorCode code, String message) {
    super(code, message);
  }
}

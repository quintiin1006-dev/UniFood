package com.santotofood.domain.exception;

import com.santotofood.shared.error.ErrorCode;

/** Structured conflict; transport chooses the public message. */
public class OrderConflictException extends InvalidOrderStateException {
  public OrderConflictException(ErrorCode code) {
    super(code);
  }
}

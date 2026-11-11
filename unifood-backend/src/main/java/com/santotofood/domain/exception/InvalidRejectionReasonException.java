package com.santotofood.domain.exception;

import com.santotofood.shared.error.ErrorCode;

/** A worker rejection needs a reason of 3 to 200 characters after trimming (400, not 409). */
public class InvalidRejectionReasonException extends DomainException {

  private InvalidRejectionReasonException(ErrorCode code, String message) {
    super(code, message);
  }

  public static InvalidRejectionReasonException required() {
    return new InvalidRejectionReasonException(
        ErrorCode.REJECTION_REASON_REQUIRED,
        "Escribe el motivo del rechazo, con al menos 3 caracteres.");
  }

  public static InvalidRejectionReasonException tooLong() {
    return new InvalidRejectionReasonException(
        ErrorCode.REJECTION_REASON_TOO_LONG, "El motivo del rechazo admite hasta 200 caracteres.");
  }
}

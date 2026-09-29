package com.santotofood.domain.exception;
import com.santotofood.shared.error.ErrorCode;

public class InvalidOrderStateException extends DomainException {

    public InvalidOrderStateException(String message) {
        super(
                ErrorCode.INVALID_ORDER_STATE,
                message
        );
    }
}
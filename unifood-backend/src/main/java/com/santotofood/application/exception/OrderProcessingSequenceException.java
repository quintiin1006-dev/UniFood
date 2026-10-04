package com.santotofood.application.exception;

import com.santotofood.shared.error.ErrorCode;

public class OrderProcessingSequenceException extends RuntimeException {

    private final ErrorCode code;

    public OrderProcessingSequenceException() {
        super(
                "No puedes preparar este pedido todavía. " +
                        "El pedido anterior debe ser procesado primero."
        );

        this.code =
                ErrorCode.ORDER_PROCESSING_SEQUENCE_VIOLATION;
    }

    public ErrorCode getCode() {
        return code;
    }
}
package com.santotofood.application.exception;

import com.santotofood.shared.error.ErrorCode;
import lombok.Getter;

import java.util.UUID;

@Getter
public class OrderNotFoundException extends RuntimeException {

    private final ErrorCode code;

    public OrderNotFoundException(UUID orderId) {
        super("No existe un pedido con id " + orderId);
        this.code = ErrorCode.ORDER_NOT_FOUND;
    }
}
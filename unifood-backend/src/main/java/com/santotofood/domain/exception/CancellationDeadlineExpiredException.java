package com.santotofood.domain.exception;
import com.santotofood.shared.error.ErrorCode;

public class CancellationDeadlineExpiredException extends DomainException {

    public CancellationDeadlineExpiredException() {
        super(
                ErrorCode.CANCELLATION_DEADLINE_EXPIRED,
                "El tiempo para cancelar el pedido ha expirado"
        );
    }
}
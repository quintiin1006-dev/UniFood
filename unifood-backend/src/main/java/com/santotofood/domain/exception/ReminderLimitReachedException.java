package com.santotofood.domain.exception;

import com.santotofood.shared.error.ErrorCode;

public class ReminderLimitReachedException extends DomainException {

    public ReminderLimitReachedException() {
        super(
                ErrorCode.REMINDER_LIMIT_REACHED,
                "Este pedido ya alcanzó el máximo de 3 recordatorios"
        );
    }
}
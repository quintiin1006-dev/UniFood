package com.santotofood.domain.exception;
import com.santotofood.shared.error.ErrorCode;

public class ReminderTooEarlyException extends DomainException {

    public ReminderTooEarlyException() {
        super(
                ErrorCode.REMINDER_TOO_EARLY,
                "Debes esperar al menos 5 minutos antes de enviar otro recordatorio"
        );
    }
}
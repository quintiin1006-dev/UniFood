package com.santotofood.domain.exception;

import com.santotofood.domain.model.Order;
import com.santotofood.shared.error.ErrorCode;

public class NotCollectedRequirementsException extends DomainException {

  public NotCollectedRequirementsException() {
    super(
        ErrorCode.NOT_COLLECTED_REQUIREMENTS_NOT_MET,
        "El pedido solo puede marcarse como no recogido después de enviar los "
            + Order.MAX_REMINDERS
            + " recordatorios");
  }
}

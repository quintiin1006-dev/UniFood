package com.santotofood.application.port.in;

import com.santotofood.application.model.ServiceFeeStatement;
import java.util.UUID;

/** ADMIN: read-only service fee of their own cafeteria, the current month and the previous ones. */
public interface GetOwnServiceFeeUseCase {
  int MONTHS = 12;

  ServiceFeeStatement statement(UUID user);
}

package com.santotofood.application.port.in;

import com.santotofood.application.model.CashViews;
import java.util.UUID;

public interface GetCashSessionUseCase {
  /** A WORKER or ADMIN reads sessions of its cafeteria; a SUPER_ADMIN reads any. */
  CashViews.Detail getSession(UUID user, UUID sessionId);
}

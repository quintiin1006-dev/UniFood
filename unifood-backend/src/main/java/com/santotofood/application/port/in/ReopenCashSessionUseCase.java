package com.santotofood.application.port.in;

import com.santotofood.application.model.CashViews;
import java.util.UUID;

public interface ReopenCashSessionUseCase {
  CashViews.Detail reopenSession(UUID user, UUID sessionId, String reason, int expectedVersion);
}

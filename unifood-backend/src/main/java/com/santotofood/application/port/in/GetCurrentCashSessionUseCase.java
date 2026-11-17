package com.santotofood.application.port.in;

import com.santotofood.application.model.CashViews;
import java.util.UUID;

public interface GetCurrentCashSessionUseCase {
  CashViews.Current currentSession(UUID user);
}

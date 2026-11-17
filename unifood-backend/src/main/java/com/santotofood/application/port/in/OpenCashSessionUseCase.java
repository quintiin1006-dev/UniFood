package com.santotofood.application.port.in;

import com.santotofood.application.model.CashSession;
import com.santotofood.application.model.CashViews;
import java.util.UUID;

public interface OpenCashSessionUseCase {
  CashViews.Current openSession(UUID user, CashSession.Shift shift, long openingFloat);
}

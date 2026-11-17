package com.santotofood.application.port.in;

import com.santotofood.application.model.CashViews;
import com.santotofood.domain.model.CashCount;
import java.util.UUID;

public interface CloseCashSessionUseCase {
  /**
   * {@code expectedCash} and {@code expectedVersion} are what the cashier confirmed in the preview:
   * if sales or movements changed since, the close is refused with the new figures. {@code force}
   * closes with READY or CALLED orders pending, and only an ADMIN may use it.
   */
  record Command(
      UUID sessionId,
      CashCount count,
      String note,
      long expectedCash,
      int expectedVersion,
      boolean force) {}

  CashViews.Detail closeSession(UUID user, Command command);
}

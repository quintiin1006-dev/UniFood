package com.santotofood.application.port.in;

import com.santotofood.application.model.CashViews;
import java.util.UUID;

public interface RecordCashMovementUseCase {
  /** Repeating the same requestId returns the movement already recorded, without a new one. */
  CashViews.Current recordMovement(
      UUID user,
      UUID sessionId,
      UUID requestId,
      CashViews.Movement.Kind kind,
      long amount,
      String reason);
}

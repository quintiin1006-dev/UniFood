package com.santotofood.application.port.in;

import java.util.UUID;

public interface UpdateCashToleranceUseCase {
  int MAX_TOLERANCE = 1_000_000;

  /** Returns the new settings version. Repeating the current value writes and audits nothing. */
  int updateTolerance(UUID user, int toleranceCop, int expectedVersion);
}

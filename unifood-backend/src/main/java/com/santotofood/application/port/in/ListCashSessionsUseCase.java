package com.santotofood.application.port.in;

import com.santotofood.application.model.CashViews;
import java.time.LocalDate;
import java.util.UUID;

public interface ListCashSessionsUseCase {
  int MAX_DAYS = 92;

  /**
   * The ADMIN lists its own cafeteria and {@code cafeteriaId} must be null. A SUPER_ADMIN lists
   * every cafeteria, or only {@code cafeteriaId} when given. Read-only for SUPER_ADMIN.
   */
  CashViews.Listing listSessions(UUID user, UUID cafeteriaId, LocalDate from, LocalDate to);
}

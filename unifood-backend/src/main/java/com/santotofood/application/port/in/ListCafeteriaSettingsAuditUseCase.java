package com.santotofood.application.port.in;

import com.santotofood.application.model.CafeteriaSettingsAuditEntry;
import java.util.List;
import java.util.UUID;

public interface ListCafeteriaSettingsAuditUseCase {
  int DEFAULT_LIMIT = 20;
  int MAX_LIMIT = 50;

  /** Most recent first. */
  List<CafeteriaSettingsAuditEntry> listAudit(
      UUID authenticatedUserId, UUID cafeteriaId, int limit);
}

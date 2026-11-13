package com.santotofood.application.port.in;

import com.santotofood.application.model.SuperAdminInstitution;
import java.util.UUID;

public interface ChangeCafeteriaVisibilityUseCase {
  /** The current value again is a 200 without writing or auditing. */
  SuperAdminInstitution.Cafeteria changeVisibility(
      UUID authenticatedUserId, UUID cafeteriaId, boolean visible, boolean expectedVisible);
}

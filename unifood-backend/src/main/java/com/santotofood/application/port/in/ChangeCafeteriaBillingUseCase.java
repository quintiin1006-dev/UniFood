package com.santotofood.application.port.in;

import com.santotofood.application.model.CafeteriaBilling;
import com.santotofood.application.model.SuperAdminInstitution;
import java.util.UUID;

public interface ChangeCafeteriaBillingUseCase {
  /** The current agreement again is a 200 without writing or auditing. */
  SuperAdminInstitution.Cafeteria changeBilling(
      UUID authenticatedUserId, UUID cafeteriaId, CafeteriaBilling billing, int expectedVersion);
}

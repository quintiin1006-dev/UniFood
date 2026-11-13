package com.santotofood.application.port.out;

import com.santotofood.application.model.CafeteriaBilling;
import com.santotofood.application.model.CafeteriaSettings;
import com.santotofood.application.model.CafeteriaSettingsAuditEntry;
import com.santotofood.application.model.SuperAdminInstitution;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface CafeteriaSettingsPort {
  /**
   * Takes the 009 provisioning guard before any user or cafeteria lock, as provisioning does:
   * exclusive when the cafeterias row will change (its statement trigger updates the guard), shared
   * otherwise.
   */
  void lockAuthorizationGuard(boolean exclusive);

  /** SET LOCAL unifood.actor_id: the 022 audit trigger records who changed it, with source API. */
  void setAuditActor(UUID actorId);

  /** Locks the cafeteria and its billing row (FOR UPDATE). */
  Optional<CafeteriaSettings> lockSettings(UUID cafeteriaId);

  /** Updates is_active and checks the 009 invariant now; false if it needs an active ADMIN. */
  boolean updateVisibility(UUID cafeteriaId, boolean visible);

  /** Bumps the version; false if the expected version no longer matches. */
  boolean updateBilling(
      UUID cafeteriaId,
      CafeteriaBilling billing,
      int expectedVersion,
      Instant updatedAt,
      UUID updatedBy);

  Optional<SuperAdminInstitution.Cafeteria> findCafeteria(UUID cafeteriaId);

  boolean cafeteriaExists(UUID cafeteriaId);

  /** Most recent first. */
  List<CafeteriaSettingsAuditEntry> findAudit(UUID cafeteriaId, int limit);
}

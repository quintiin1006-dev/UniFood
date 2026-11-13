package com.santotofood.application.service;

import com.santotofood.application.exception.CafeteriaSettingsException;
import com.santotofood.application.exception.SuperAdminForbiddenException;
import com.santotofood.application.model.CafeteriaBilling;
import com.santotofood.application.model.CafeteriaSettings;
import com.santotofood.application.model.CafeteriaSettingsAuditEntry;
import com.santotofood.application.model.SuperAdminInstitution;
import com.santotofood.application.port.in.ChangeCafeteriaBillingUseCase;
import com.santotofood.application.port.in.ChangeCafeteriaVisibilityUseCase;
import com.santotofood.application.port.in.ListCafeteriaSettingsAuditUseCase;
import com.santotofood.application.port.out.CafeteriaSettingsPort;
import com.santotofood.domain.port.out.TimeProvider;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

/**
 * SUPER_ADMIN visibility and billing of a cafeteria (decisiones §5, migration 022). The audit row
 * is written by trigger in the same transaction; Spring only tells it who the actor is.
 */
@Service
public class CafeteriaSettingsService
    implements ChangeCafeteriaVisibilityUseCase,
        ChangeCafeteriaBillingUseCase,
        ListCafeteriaSettingsAuditUseCase {
  private final OrderAuthorizationService authorization;
  private final CafeteriaSettingsPort settings;
  private final TimeProvider time;

  public CafeteriaSettingsService(
      OrderAuthorizationService authorization, CafeteriaSettingsPort settings, TimeProvider time) {
    this.authorization = authorization;
    this.settings = settings;
    this.time = time;
  }

  private void authorize(UUID user) {
    Objects.requireNonNull(user);
    // The guard already ran; repeating it after the lock keeps the decision current.
    if (!authorization.superAdmin(user)) throw new SuperAdminForbiddenException();
  }

  private CafeteriaSettings lock(UUID cafeteriaId) {
    return settings
        .lockSettings(Objects.requireNonNull(cafeteriaId))
        .orElseThrow(CafeteriaSettingsException::cafeteriaNotFound);
  }

  private SuperAdminInstitution.Cafeteria current(UUID cafeteriaId) {
    return settings
        .findCafeteria(cafeteriaId)
        .orElseThrow(() -> new IllegalStateException("Locked cafeteria disappeared"));
  }

  @Override
  @Transactional(isolation = Isolation.READ_COMMITTED, timeout = 15)
  public SuperAdminInstitution.Cafeteria changeVisibility(
      UUID user, UUID cafeteriaId, boolean visible, boolean expectedVisible) {
    // Exclusive: the 009 statement trigger on cafeterias updates the guard anyway, and taking it
    // first keeps provisioning's order (guard, then users and cafeterias): no deadlock.
    settings.lockAuthorizationGuard(true);
    authorize(user);
    var state = lock(cafeteriaId);
    if (state.visible() == visible) return current(cafeteriaId); // repeated: no write, no audit
    if (state.visible() != expectedVisible) throw CafeteriaSettingsException.visibilityChanged();
    if (visible && !state.hasActiveAdmin()) throw CafeteriaSettingsException.requiresAdmin();
    settings.setAuditActor(user);
    if (!settings.updateVisibility(cafeteriaId, visible))
      throw CafeteriaSettingsException.requiresAdmin();
    return current(cafeteriaId);
  }

  @Override
  @Transactional(isolation = Isolation.READ_COMMITTED, timeout = 15)
  public SuperAdminInstitution.Cafeteria changeBilling(
      UUID user, UUID cafeteriaId, CafeteriaBilling billing, int expectedVersion) {
    Objects.requireNonNull(billing);
    if (expectedVersion < 0) throw CafeteriaSettingsException.invalidRequest();
    settings.lockAuthorizationGuard(false);
    authorize(user);
    var state = lock(cafeteriaId);
    if (state.billing().equals(billing)) return current(cafeteriaId); // repeated: no write
    if (state.billingVersion() != expectedVersion)
      throw CafeteriaSettingsException.billingChanged();
    settings.setAuditActor(user);
    if (!settings.updateBilling(cafeteriaId, billing, expectedVersion, time.now(), user))
      throw CafeteriaSettingsException.billingChanged();
    return current(cafeteriaId);
  }

  @Override
  @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ, timeout = 15)
  public List<CafeteriaSettingsAuditEntry> listAudit(UUID user, UUID cafeteriaId, int limit) {
    if (limit < 1 || limit > MAX_LIMIT) throw CafeteriaSettingsException.invalidRequest();
    authorize(user);
    if (!settings.cafeteriaExists(Objects.requireNonNull(cafeteriaId)))
      throw CafeteriaSettingsException.cafeteriaNotFound();
    return settings.findAudit(cafeteriaId, limit);
  }
}

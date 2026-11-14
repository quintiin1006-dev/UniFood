package com.santotofood.application.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.santotofood.application.exception.CafeteriaSettingsException;
import com.santotofood.application.exception.SuperAdminForbiddenException;
import com.santotofood.application.model.CafeteriaBilling;
import com.santotofood.application.model.CafeteriaSettings;
import com.santotofood.application.model.SuperAdminInstitution;
import com.santotofood.application.model.UserAuthorization;
import com.santotofood.application.port.out.AuthorizationQueryPort;
import com.santotofood.application.port.out.CafeteriaSettingsPort;
import com.santotofood.shared.error.ErrorCode;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;

class CafeteriaSettingsServiceTest {
  static final Instant NOW = Instant.parse("2026-11-12T15:00:00Z");
  final AuthorizationQueryPort facts = mock(AuthorizationQueryPort.class);
  final CafeteriaSettingsPort port = mock(CafeteriaSettingsPort.class);
  final CafeteriaSettingsService service =
      new CafeteriaSettingsService(new OrderAuthorizationService(facts), port, () -> NOW);
  final UUID user = UUID.randomUUID(), cafeteria = UUID.randomUUID();
  static final CafeteriaBilling NONE = CafeteriaBilling.none();
  static final CafeteriaBilling FEE =
      new CafeteriaBilling(CafeteriaBilling.Model.PER_ORDER_FEE, 1000, null);
  static final CafeteriaBilling MONTHLY =
      new CafeteriaBilling(CafeteriaBilling.Model.SUBSCRIPTION, null, 250000);

  @BeforeEach
  void superAdmin() {
    when(facts.findUserAuthorization(user))
        .thenReturn(Optional.of(new UserAuthorization(true, Set.of("SUPER_ADMIN"), List.of())));
    when(port.findCafeteria(cafeteria))
        .thenReturn(
            Optional.of(
                new SuperAdminInstitution.Cafeteria(
                    cafeteria, "Cafetería Central", true, true, NONE, 0)));
  }

  void state(boolean visible, boolean admin, CafeteriaBilling billing, int version) {
    when(port.lockSettings(cafeteria))
        .thenReturn(Optional.of(new CafeteriaSettings(visible, admin, billing, version)));
  }

  static ErrorCode code(Runnable call) {
    return assertThrows(CafeteriaSettingsException.class, call::run).code();
  }

  // ---------------------------------------------------------------- visibility

  @Test
  void hidingLocksTheGuardFirstThenNamesTheActorBeforeWriting() {
    state(true, true, NONE, 0);
    when(port.updateVisibility(cafeteria, false)).thenReturn(true);
    service.changeVisibility(user, cafeteria, false, true);
    InOrder order = inOrder(port, facts);
    order.verify(port).lockAuthorizationGuard(true);
    order.verify(facts).findUserAuthorization(user);
    order.verify(port).lockSettings(cafeteria);
    order.verify(port).setAuditActor(user);
    order.verify(port).updateVisibility(cafeteria, false);
  }

  @Test
  void hidingIsAllowedWithoutAnActiveAdmin() {
    state(true, false, NONE, 0);
    when(port.updateVisibility(cafeteria, false)).thenReturn(true);
    service.changeVisibility(user, cafeteria, false, true);
    verify(port).updateVisibility(cafeteria, false);
  }

  @Test
  void repeatingTheCurrentVisibilityWritesAndAuditsNothing() {
    state(false, true, NONE, 0);
    // Also when expectedVisible is stale: a retry of a change that already happened.
    service.changeVisibility(user, cafeteria, false, true);
    service.changeVisibility(user, cafeteria, false, false);
    verify(port, never()).setAuditActor(any());
    verify(port, never()).updateVisibility(any(), anyBoolean());
  }

  @Test
  void aStaleExpectedVisibilityIsAConflict() {
    state(false, true, NONE, 0);
    assertEquals(
        ErrorCode.VISIBILITY_STATE_CHANGED,
        code(() -> service.changeVisibility(user, cafeteria, true, true)));
    verify(port, never()).updateVisibility(any(), anyBoolean());
  }

  @Test
  void showingWithoutAnActiveAdminIsRefusedBeforeWriting() {
    state(false, false, NONE, 0);
    assertEquals(
        ErrorCode.CAFETERIA_REQUIRES_ADMIN,
        code(() -> service.changeVisibility(user, cafeteria, true, false)));
    verify(port, never()).updateVisibility(any(), anyBoolean());
  }

  @Test
  void theDatabaseInvariantStillRefusesAShowRace() {
    state(false, true, NONE, 0);
    when(port.updateVisibility(cafeteria, true)).thenReturn(false);
    assertEquals(
        ErrorCode.CAFETERIA_REQUIRES_ADMIN,
        code(() -> service.changeVisibility(user, cafeteria, true, false)));
  }

  @Test
  void anUnknownCafeteriaIs404() {
    when(port.lockSettings(cafeteria)).thenReturn(Optional.empty());
    assertEquals(
        ErrorCode.CAFETERIA_NOT_FOUND,
        code(() -> service.changeVisibility(user, cafeteria, false, true)));
  }

  @Test
  void aNonSuperAdminNeverLocksTheCafeteriaOrWrites() {
    when(facts.findUserAuthorization(user))
        .thenReturn(Optional.of(new UserAuthorization(true, Set.of("ADMIN"), List.of(cafeteria))));
    assertThrows(
        SuperAdminForbiddenException.class,
        () -> service.changeVisibility(user, cafeteria, false, true));
    assertThrows(
        SuperAdminForbiddenException.class, () -> service.changeBilling(user, cafeteria, FEE, 0));
    assertThrows(SuperAdminForbiddenException.class, () -> service.listAudit(user, cafeteria, 20));
    verify(port, never()).lockSettings(any());
    verify(port, never()).setAuditActor(any());
    verify(port, never()).findAudit(any(), anyInt());
  }

  // ---------------------------------------------------------------- billing

  @Test
  void changingBillingBumpsTheVersionWithSpringsClockAndTheActor() {
    state(true, true, NONE, 4);
    when(port.updateBilling(cafeteria, MONTHLY, 4, NOW, user)).thenReturn(true);
    service.changeBilling(user, cafeteria, MONTHLY, 4);
    InOrder order = inOrder(port);
    order.verify(port).lockAuthorizationGuard(false);
    order.verify(port).lockSettings(cafeteria);
    order.verify(port).setAuditActor(user);
    order.verify(port).updateBilling(cafeteria, MONTHLY, 4, NOW, user);
  }

  @Test
  void repeatingTheCurrentAgreementWritesNothingEvenWithAnOldVersion() {
    state(true, true, FEE, 7);
    service.changeBilling(user, cafeteria, FEE, 7);
    service.changeBilling(
        user, cafeteria, new CafeteriaBilling(CafeteriaBilling.Model.PER_ORDER_FEE, 1000, null), 3);
    verify(port, never()).setAuditActor(any());
    verify(port, never()).updateBilling(any(), any(), anyInt(), any(), any());
  }

  @Test
  void anotherAmountIsAChange() {
    state(true, true, FEE, 1);
    var other = new CafeteriaBilling(CafeteriaBilling.Model.PER_ORDER_FEE, 1500, null);
    when(port.updateBilling(cafeteria, other, 1, NOW, user)).thenReturn(true);
    service.changeBilling(user, cafeteria, other, 1);
    verify(port).updateBilling(cafeteria, other, 1, NOW, user);
  }

  @Test
  void aStaleVersionIsAConflictBeforeOrDuringTheWrite() {
    state(true, true, NONE, 2);
    assertEquals(
        ErrorCode.BILLING_STATE_CHANGED,
        code(() -> service.changeBilling(user, cafeteria, FEE, 1)));
    verify(port, never()).updateBilling(any(), any(), anyInt(), any(), any());
    when(port.updateBilling(cafeteria, FEE, 2, NOW, user)).thenReturn(false);
    assertEquals(
        ErrorCode.BILLING_STATE_CHANGED,
        code(() -> service.changeBilling(user, cafeteria, FEE, 2)));
  }

  @Test
  void aNegativeVersionIsInvalid() {
    assertEquals(
        ErrorCode.SUPER_ADMIN_INVALID_REQUEST,
        code(() -> service.changeBilling(user, cafeteria, FEE, -1)));
    verifyNoInteractions(port);
  }

  @Test
  void theAgreementRulesMatchMigration022() {
    for (var valid :
        List.of(
            new Object[] {CafeteriaBilling.Model.NONE, null, null},
            new Object[] {CafeteriaBilling.Model.SUBSCRIPTION, null, null},
            new Object[] {CafeteriaBilling.Model.SUBSCRIPTION, null, 1},
            new Object[] {CafeteriaBilling.Model.SUBSCRIPTION, null, 100_000_000},
            new Object[] {CafeteriaBilling.Model.PER_ORDER_FEE, 1, null},
            new Object[] {CafeteriaBilling.Model.PER_ORDER_FEE, 1_000_000, null}))
      assertDoesNotThrow(
          () ->
              new CafeteriaBilling(
                  (CafeteriaBilling.Model) valid[0], (Integer) valid[1], (Integer) valid[2]));
    for (var invalid :
        List.of(
            new Object[] {null, null, null},
            new Object[] {CafeteriaBilling.Model.PER_ORDER_FEE, null, null},
            new Object[] {CafeteriaBilling.Model.PER_ORDER_FEE, 0, null},
            new Object[] {CafeteriaBilling.Model.PER_ORDER_FEE, 1_000_001, null},
            new Object[] {CafeteriaBilling.Model.PER_ORDER_FEE, 1000, 50000},
            new Object[] {CafeteriaBilling.Model.NONE, 1000, null},
            new Object[] {CafeteriaBilling.Model.NONE, null, 50000},
            new Object[] {CafeteriaBilling.Model.SUBSCRIPTION, 1000, null},
            new Object[] {CafeteriaBilling.Model.SUBSCRIPTION, null, 0},
            new Object[] {CafeteriaBilling.Model.SUBSCRIPTION, null, 100_000_001}))
      assertEquals(
          ErrorCode.BILLING_INVALID_REQUEST,
          code(
              () ->
                  new CafeteriaBilling(
                      (CafeteriaBilling.Model) invalid[0],
                      (Integer) invalid[1],
                      (Integer) invalid[2])));
  }

  // ---------------------------------------------------------------- audit

  @Test
  void auditNeedsAnExistingCafeteriaAndABoundedLimit() {
    when(port.cafeteriaExists(cafeteria)).thenReturn(false);
    assertEquals(ErrorCode.CAFETERIA_NOT_FOUND, code(() -> service.listAudit(user, cafeteria, 20)));
    for (int limit : new int[] {0, 51})
      assertEquals(
          ErrorCode.SUPER_ADMIN_INVALID_REQUEST,
          code(() -> service.listAudit(user, cafeteria, limit)));
    when(port.cafeteriaExists(cafeteria)).thenReturn(true);
    when(port.findAudit(cafeteria, 50)).thenReturn(List.of());
    assertEquals(List.of(), service.listAudit(user, cafeteria, 50));
  }
}

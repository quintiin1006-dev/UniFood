package com.santotofood.application.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

import com.santotofood.application.exception.ServiceFeeException;
import com.santotofood.application.model.ServiceFeeMonth.Status;
import com.santotofood.application.model.UserAuthorization;
import com.santotofood.application.port.out.AuthorizationQueryPort;
import com.santotofood.application.port.out.ServiceFeeSettingsPort;
import com.santotofood.application.port.out.ServiceFeeSettingsPort.CafeteriaRow;
import com.santotofood.application.port.out.ServiceFeeSettingsPort.General;
import com.santotofood.application.port.out.ServiceFeeSettingsPort.OwnFee;
import com.santotofood.application.port.out.ServiceFeeSettingsPort.Settlement;
import com.santotofood.application.port.out.ServiceFeeSettingsPort.Summary;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** Settings, settlements, overdue rule and roles of the service fee (docs/modelo-de-negocio.md). */
class ServiceFeeServiceTest {
  static final UUID SUPER = UUID.randomUUID();
  static final UUID ADMIN = UUID.randomUUID();
  static final UUID OTHER_ADMIN = UUID.randomUUID();
  static final UUID WORKER = UUID.randomUUID();
  static final UUID CAFE = UUID.randomUUID();
  static final UUID OTHER_CAFE = UUID.randomUUID();
  // 2026-11-22 12:00 in America/Bogota.
  static final Instant NOW = Instant.parse("2026-11-22T17:00:00Z");
  static final YearMonth NOVEMBER = YearMonth.of(2026, 11);
  static final YearMonth OCTOBER = YearMonth.of(2026, 10);

  ServiceFeeSettingsPort fees;
  AuthorizationQueryPort users;
  boolean enabled = true;
  Instant now = NOW;
  ServiceFeeService service;

  @BeforeEach
  void setUp() {
    fees = mock(ServiceFeeSettingsPort.class);
    users = mock(AuthorizationQueryPort.class);
    when(users.findUserAuthorization(SUPER))
        .thenReturn(Optional.of(new UserAuthorization(true, Set.of("SUPER_ADMIN"), List.of())));
    when(users.findUserAuthorization(ADMIN))
        .thenReturn(Optional.of(new UserAuthorization(true, Set.of("ADMIN"), List.of(CAFE))));
    when(users.findUserAuthorization(OTHER_ADMIN))
        .thenReturn(Optional.of(new UserAuthorization(true, Set.of("ADMIN"), List.of(OTHER_CAFE))));
    when(users.findUserAuthorization(WORKER))
        .thenReturn(Optional.of(new UserAuthorization(true, Set.of("WORKER"), List.of(CAFE))));
    service =
        new ServiceFeeService(
            () -> enabled, new OrderAuthorizationService(users), users, fees, () -> now);
    when(fees.general()).thenReturn(new General(300, 0, NOW));
    when(fees.lockGeneral()).thenReturn(new General(300, 0, NOW));
    when(fees.cafeterias())
        .thenReturn(
            List.of(
                new CafeteriaRow(CAFE, "Cafetería Central", "Sede Principal", true, null, 0),
                new CafeteriaRow(OTHER_CAFE, "Cafetería Norte", "Sede Norte", true, 0, 1)));
    when(fees.cafeteria(CAFE))
        .thenReturn(
            Optional.of(
                new CafeteriaRow(CAFE, "Cafetería Central", "Sede Principal", true, null, 0)));
    when(fees.cafeteria(OTHER_CAFE))
        .thenReturn(
            Optional.of(new CafeteriaRow(OTHER_CAFE, "Cafetería Norte", "Sede Norte", true, 0, 1)));
    when(fees.summary(any(), any())).thenReturn(new Summary(4, new BigDecimal("36000.00"), 1200));
    when(fees.updateGeneral(anyInt(), anyInt(), any(), any())).thenReturn(true);
    when(fees.updateCafeteriaFee(any(), any(), anyInt(), any(), any())).thenReturn(true);
  }

  static Settlement closed(UUID cafeteria, YearMonth month, String status) {
    return new Settlement(
        cafeteria,
        month.atDay(1),
        4,
        new BigDecimal("36000.00"),
        1200,
        status,
        "PAGADA".equals(status) ? NOW : null,
        null,
        NOW);
  }

  ServiceFeeException refused(Runnable call) {
    return assertThrows(ServiceFeeException.class, call::run);
  }

  // ------------------------------------------------------------ flag and roles

  @Test
  void withTheFlagOffEveryCallIsDisabled() {
    enabled = false;
    for (Runnable call :
        List.<Runnable>of(
            () -> service.overview(SUPER),
            () -> service.changeGeneralFee(SUPER, 400, 0),
            () -> service.month(SUPER, NOVEMBER),
            () -> service.closeMonth(SUPER, CAFE, OCTOBER),
            () -> service.markPaid(SUPER, CAFE, OCTOBER, null),
            () -> service.statement(ADMIN)))
      assertEquals("SERVICE_FEE_DISABLED", refused(call).code().name());
    verifyNoInteractions(fees);
  }

  @Test
  void onlyTheSuperAdminManagesTheFee() {
    for (UUID user : new UUID[] {ADMIN, WORKER, UUID.randomUUID()}) {
      assertEquals(
          ServiceFeeException.Kind.FORBIDDEN, refused(() -> service.overview(user)).kind());
      assertEquals(
          ServiceFeeException.Kind.FORBIDDEN,
          refused(() -> service.changeGeneralFee(user, 400, 0)).kind());
      assertEquals(
          ServiceFeeException.Kind.FORBIDDEN,
          refused(() -> service.closeMonth(user, CAFE, OCTOBER)).kind());
      assertEquals(
          ServiceFeeException.Kind.FORBIDDEN,
          refused(() -> service.markPaid(user, CAFE, OCTOBER, null)).kind());
    }
    verify(fees, never()).updateGeneral(anyInt(), anyInt(), any(), any());
    verify(fees, never()).closeMonth(any(), any(), any());
  }

  @Test
  void anAdminSeesOnlyTheirOwnCafeteria() {
    var statement = service.statement(ADMIN);
    assertEquals(CAFE, statement.cafeteriaId());
    assertEquals(300, statement.currentFeeCop()); // no own value: the general one
    verify(fees, never()).summary(eq(OTHER_CAFE), any());
    verify(fees, never()).settlementsOf(eq(OTHER_CAFE), anyInt());
    // The other admin gets their own, never ours; a worker or super admin gets nothing.
    assertEquals(OTHER_CAFE, service.statement(OTHER_ADMIN).cafeteriaId());
    assertEquals(0, service.statement(OTHER_ADMIN).currentFeeCop());
    assertEquals(
        ServiceFeeException.Kind.FORBIDDEN, refused(() -> service.statement(WORKER)).kind());
    assertEquals(
        ServiceFeeException.Kind.FORBIDDEN, refused(() -> service.statement(SUPER)).kind());
  }

  @Test
  void anInactiveAdminOrOneWithTwoCafeteriasIsRefused() {
    when(users.findUserAuthorization(ADMIN))
        .thenReturn(Optional.of(new UserAuthorization(false, Set.of("ADMIN"), List.of(CAFE))));
    assertEquals(
        ServiceFeeException.Kind.FORBIDDEN, refused(() -> service.statement(ADMIN)).kind());
    when(users.findUserAuthorization(ADMIN))
        .thenReturn(
            Optional.of(new UserAuthorization(true, Set.of("ADMIN"), List.of(CAFE, OTHER_CAFE))));
    assertEquals(
        ServiceFeeException.Kind.FORBIDDEN, refused(() -> service.statement(ADMIN)).kind());
  }

  @Test
  void theAdminStatementListsTheCurrentMonthFirstAndNeverBeforeThePilot() {
    when(fees.settlementsOf(CAFE, 12)).thenReturn(List.of(closed(CAFE, OCTOBER, "PAGADA")));
    var months = service.statement(ADMIN).months();
    assertEquals(NOVEMBER, months.get(0).month());
    assertEquals(Status.ABIERTO, months.get(0).status());
    assertEquals(Status.PAGADA, months.get(1).status());
    assertEquals(11, months.size()); // January to November 2026
    assertEquals(ServiceFeeRules.FIRST_MONTH, months.getLast().month());
  }

  // ------------------------------------------------------------ values

  @Test
  void changesTheGeneralFeeOnceAndNamesTheActor() {
    service.changeGeneralFee(SUPER, 400, 0);
    var order = inOrder(fees);
    order.verify(fees).lockGeneral();
    order.verify(fees).setAuditActor(SUPER);
    order.verify(fees).updateGeneral(400, 0, NOW, SUPER);
  }

  @Test
  void theSameValueAgainWritesNothing() {
    service.changeGeneralFee(SUPER, 300, 7);
    verify(fees, never()).updateGeneral(anyInt(), anyInt(), any(), any());
    verify(fees, never()).setAuditActor(any());
  }

  @Test
  void aStaleVersionIsAConflict() {
    assertEquals(
        "SERVICE_FEE_STATE_CHANGED",
        refused(() -> service.changeGeneralFee(SUPER, 400, 3)).code().name());
    when(fees.updateGeneral(anyInt(), anyInt(), any(), any())).thenReturn(false);
    assertEquals(
        "SERVICE_FEE_STATE_CHANGED",
        refused(() -> service.changeGeneralFee(SUPER, 400, 0)).code().name());
  }

  @Test
  void feesOutsideZeroToTwoThousandAreRefusedBeforeAnyRead() {
    for (int fee : new int[] {-1, 2001})
      assertEquals(
          ServiceFeeException.Kind.BAD_REQUEST,
          refused(() -> service.changeGeneralFee(SUPER, fee, 0)).kind());
    assertEquals(
        ServiceFeeException.Kind.BAD_REQUEST,
        refused(() -> service.changeCafeteriaFee(SUPER, CAFE, 2001, 0)).kind());
    verifyNoInteractions(fees);
    // The limits themselves are valid.
    service.changeGeneralFee(SUPER, 2000, 0);
    service.changeGeneralFee(SUPER, 0, 0);
  }

  @Test
  void aCafeteriaMayHaveZeroOrGoBackToTheGeneralFee() {
    when(fees.lockCafeteriaFee(CAFE)).thenReturn(Optional.of(new OwnFee(null, 0)));
    service.changeCafeteriaFee(SUPER, CAFE, 0, 0);
    verify(fees).updateCafeteriaFee(CAFE, 0, 0, NOW, SUPER);
    when(fees.lockCafeteriaFee(CAFE)).thenReturn(Optional.of(new OwnFee(0, 1)));
    service.changeCafeteriaFee(SUPER, CAFE, null, 1);
    verify(fees).updateCafeteriaFee(CAFE, null, 1, NOW, SUPER);
    when(fees.lockCafeteriaFee(any())).thenReturn(Optional.empty());
    assertEquals(
        "CAFETERIA_NOT_FOUND",
        refused(() -> service.changeCafeteriaFee(SUPER, UUID.randomUUID(), 100, 0)).code().name());
  }

  @Test
  void theOverviewShowsTheEffectiveFeeOfEachCafeteria() {
    var overview = service.overview(SUPER);
    assertEquals(300, overview.general().feeCop());
    assertNull(overview.cafeterias().get(0).ownFeeCop());
    assertEquals(300, overview.cafeterias().get(0).effectiveFeeCop());
    assertEquals(0, overview.cafeterias().get(1).effectiveFeeCop());
  }

  // ------------------------------------------------------------ months

  @Test
  void theCurrentMonthIsLiveAndCannotBeClosed() {
    var month = service.month(SUPER, NOVEMBER);
    assertTrue(month.current());
    assertEquals(Status.ABIERTO, month.rows().get(0).status());
    assertFalse(month.rows().get(0).closable());
    assertEquals(1200, month.rows().get(0).feeTotal());
    assertEquals(
        "SERVICE_FEE_MONTH_OPEN",
        refused(() -> service.closeMonth(SUPER, CAFE, NOVEMBER)).code().name());
    verify(fees, never()).closeMonth(any(), any(), any());
  }

  @Test
  void futureAndPrePilotMonthsAreInvalid() {
    assertEquals(
        ServiceFeeException.Kind.BAD_REQUEST,
        refused(() -> service.month(SUPER, YearMonth.of(2026, 12))).kind());
    assertEquals(
        ServiceFeeException.Kind.BAD_REQUEST,
        refused(() -> service.month(SUPER, YearMonth.of(2025, 12))).kind());
  }

  @Test
  void closingTwiceReturnsTheSameFrozenMonth() {
    when(fees.settlement(CAFE, OCTOBER.atDay(1)))
        .thenReturn(Optional.of(closed(CAFE, OCTOBER, "PENDIENTE")));
    var first = service.closeMonth(SUPER, CAFE, OCTOBER);
    when(fees.closeMonth(any(), any(), any())).thenReturn(false); // already there
    var second = service.closeMonth(SUPER, CAFE, OCTOBER);
    assertEquals(first, second);
    assertEquals(Status.PENDIENTE, second.status());
    assertEquals(1200, second.feeTotal());
  }

  @Test
  void aClosedMonthIsNeverRecalculated() {
    when(fees.settlementsOfMonth(OCTOBER.atDay(1)))
        .thenReturn(List.of(closed(CAFE, OCTOBER, "PENDIENTE")));
    // Live sum would now say something else: the frozen copy wins.
    when(fees.summary(eq(CAFE), any())).thenReturn(new Summary(99, BigDecimal.TEN, 99_999));
    var row = service.month(SUPER, OCTOBER).rows().get(0);
    assertEquals(1200, row.feeTotal());
    assertEquals(4, row.deliveredOrders());
    verify(fees, never()).summary(eq(CAFE), any());
    // The other cafeteria is still open for October and can be closed.
    var open = service.month(SUPER, OCTOBER).rows().get(1);
    assertEquals(Status.ABIERTO, open.status());
    assertTrue(open.closable());
  }

  @Test
  void markingPaidNeedsAClosedMonthAndIsIdempotent() {
    assertEquals(
        "SERVICE_FEE_MONTH_NOT_CLOSED",
        refused(() -> service.markPaid(SUPER, CAFE, OCTOBER, null)).code().name());
    when(fees.lockSettlement(CAFE, OCTOBER.atDay(1)))
        .thenReturn(Optional.of(closed(CAFE, OCTOBER, "PENDIENTE")));
    when(fees.markPaid(any(), any(), any(), any(), any())).thenReturn(true);
    when(fees.settlement(CAFE, OCTOBER.atDay(1)))
        .thenReturn(Optional.of(closed(CAFE, OCTOBER, "PAGADA")));
    assertEquals(
        Status.PAGADA, service.markPaid(SUPER, CAFE, OCTOBER, "  Transferencia 123 ").status());
    verify(fees).markPaid(CAFE, OCTOBER.atDay(1), NOW, SUPER, "Transferencia 123");
    // Already PAGADA: nothing more is written.
    when(fees.lockSettlement(CAFE, OCTOBER.atDay(1)))
        .thenReturn(Optional.of(closed(CAFE, OCTOBER, "PAGADA")));
    assertEquals(Status.PAGADA, service.markPaid(SUPER, CAFE, OCTOBER, null).status());
    verify(fees, times(1)).markPaid(any(), any(), any(), any(), any());
    assertEquals(
        ServiceFeeException.Kind.BAD_REQUEST,
        refused(() -> service.markPaid(SUPER, CAFE, OCTOBER, "x".repeat(201))).kind());
  }

  // ------------------------------------------------------------ overdue (rule 9)

  @Test
  void aPendingMonthIsOverdueMoreThanTenDaysAfterItEnds() {
    when(fees.settlementsOfMonth(OCTOBER.atDay(1)))
        .thenReturn(List.of(closed(CAFE, OCTOBER, "PENDIENTE")));
    // October ends on the 31st: due on November 10, overdue from the 11th. Today is the 22nd.
    var row = service.month(SUPER, OCTOBER).rows().get(0);
    assertTrue(row.overdue());
    assertEquals(12, row.daysOverdue());

    now = Instant.parse("2026-11-10T17:00:00Z"); // the last day of grace
    row = service.month(SUPER, OCTOBER).rows().get(0);
    assertFalse(row.overdue());
    assertEquals(0, row.daysOverdue());

    now = Instant.parse("2026-11-11T05:00:00Z"); // 00:00 of the 11th in Bogota
    assertEquals(1, service.month(SUPER, OCTOBER).rows().get(0).daysOverdue());
  }

  @Test
  void aPaidMonthIsNeverOverdue() {
    when(fees.settlementsOfMonth(OCTOBER.atDay(1)))
        .thenReturn(List.of(closed(CAFE, OCTOBER, "PAGADA")));
    now = Instant.parse("2027-01-15T17:00:00Z");
    var row = service.month(SUPER, OCTOBER).rows().get(0);
    assertFalse(row.overdue());
    assertEquals(0, row.daysOverdue());
  }

  @Test
  void theGraceDaysAreANamedConstant() {
    assertEquals(10, ServiceFeeRules.SETTLEMENT_GRACE_DAYS);
    assertEquals(LocalDate.of(2026, 11, 10), ServiceFeeRules.dueDate(OCTOBER));
  }
}

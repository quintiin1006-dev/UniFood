package com.santotofood.application.service;

import com.santotofood.application.exception.ServiceFeeException;
import com.santotofood.application.model.ServiceFeeAuditEntry;
import com.santotofood.application.model.ServiceFeeMonth;
import com.santotofood.application.model.ServiceFeeMonth.Row;
import com.santotofood.application.model.ServiceFeeMonth.Status;
import com.santotofood.application.model.ServiceFeeOverview;
import com.santotofood.application.model.ServiceFeeStatement;
import com.santotofood.application.port.in.GetOwnServiceFeeUseCase;
import com.santotofood.application.port.in.ManageServiceFeeUseCase;
import com.santotofood.application.port.out.AuthorizationQueryPort;
import com.santotofood.application.port.out.ServiceFeeFlag;
import com.santotofood.application.port.out.ServiceFeeSettingsPort;
import com.santotofood.application.port.out.ServiceFeeSettingsPort.CafeteriaRow;
import com.santotofood.application.port.out.ServiceFeeSettingsPort.Settlement;
import com.santotofood.domain.port.out.TimeProvider;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Service fee settings and monthly settlements (docs/modelo-de-negocio.md, rules 2 and 6 to 12).
 * SUPER_ADMIN manages every cafeteria; an ADMIN reads only their own. Role, activity and cafeteria
 * come from the database on every call. With SERVICE_FEE_ENABLED off every call is a 404
 * SERVICE_FEE_DISABLED.
 */
@Service
public class ServiceFeeService implements ManageServiceFeeUseCase, GetOwnServiceFeeUseCase {
  static final int MAX_NOTE_LENGTH = 200;

  private final ServiceFeeFlag flag;
  private final OrderAuthorizationService authorization;
  private final AuthorizationQueryPort users;
  private final ServiceFeeSettingsPort fees;
  private final TimeProvider time;

  public ServiceFeeService(
      ServiceFeeFlag flag,
      OrderAuthorizationService authorization,
      AuthorizationQueryPort users,
      ServiceFeeSettingsPort fees,
      TimeProvider time) {
    this.flag = flag;
    this.authorization = authorization;
    this.users = users;
    this.fees = fees;
    this.time = time;
  }

  private void superAdmin(UUID user) {
    if (!flag.enabled()) throw ServiceFeeException.disabled();
    if (!authorization.superAdmin(Objects.requireNonNull(user)))
      throw ServiceFeeException.forbidden();
  }

  private LocalDate today() {
    return LocalDate.ofInstant(time.now(), ServiceFeeRules.ZONE);
  }

  private static void validMonth(YearMonth month, YearMonth current) {
    if (month == null || month.isBefore(ServiceFeeRules.FIRST_MONTH) || month.isAfter(current))
      throw ServiceFeeException.invalidRequest();
  }

  // ---------------------------------------------------------------- settings

  @Override
  @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ, timeout = 15)
  public ServiceFeeOverview overview(UUID user) {
    superAdmin(user);
    return overview();
  }

  private ServiceFeeOverview overview() {
    var general = fees.general();
    var cafeterias =
        fees.cafeterias().stream()
            .map(
                row ->
                    new ServiceFeeOverview.Cafeteria(
                        row.id(),
                        row.name(),
                        row.siteName(),
                        row.visible(),
                        row.ownFeeCop(),
                        row.ownFeeCop() == null ? general.feeCop() : row.ownFeeCop(),
                        row.version()))
            .toList();
    return new ServiceFeeOverview(
        new ServiceFeeOverview.General(general.feeCop(), general.version(), general.updatedAt()),
        cafeterias);
  }

  @Override
  @Transactional(isolation = Isolation.READ_COMMITTED, timeout = 15)
  public ServiceFeeOverview changeGeneralFee(UUID user, int feeCop, int expectedVersion) {
    if (!ServiceFeeRules.validFee(feeCop) || expectedVersion < 0)
      throw ServiceFeeException.invalidRequest();
    superAdmin(user);
    var current = fees.lockGeneral();
    if (current.feeCop() == feeCop) return overview(); // repeated: no write, no audit
    if (current.version() != expectedVersion) throw ServiceFeeException.stateChanged();
    fees.setAuditActor(user);
    if (!fees.updateGeneral(feeCop, expectedVersion, time.now(), user))
      throw ServiceFeeException.stateChanged();
    return overview();
  }

  @Override
  @Transactional(isolation = Isolation.READ_COMMITTED, timeout = 15)
  public ServiceFeeOverview changeCafeteriaFee(
      UUID user, UUID cafeteriaId, Integer feeCop, int expectedVersion) {
    if ((feeCop != null && !ServiceFeeRules.validFee(feeCop)) || expectedVersion < 0)
      throw ServiceFeeException.invalidRequest();
    superAdmin(user);
    var current =
        fees.lockCafeteriaFee(Objects.requireNonNull(cafeteriaId))
            .orElseThrow(ServiceFeeException::cafeteriaNotFound);
    if (Objects.equals(current.feeCop(), feeCop)) return overview();
    if (current.version() != expectedVersion) throw ServiceFeeException.stateChanged();
    fees.setAuditActor(user);
    if (!fees.updateCafeteriaFee(cafeteriaId, feeCop, expectedVersion, time.now(), user))
      throw ServiceFeeException.stateChanged();
    return overview();
  }

  @Override
  @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ, timeout = 15)
  public List<ServiceFeeAuditEntry> audit(UUID user, int limit) {
    if (limit < 1 || limit > MAX_AUDIT_LIMIT) throw ServiceFeeException.invalidRequest();
    superAdmin(user);
    return fees.audit(limit);
  }

  // ---------------------------------------------------------------- settlements

  @Override
  @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ, timeout = 15)
  public ServiceFeeMonth month(UUID user, YearMonth month) {
    superAdmin(user);
    var today = today();
    var current = YearMonth.from(today);
    validMonth(month, current);
    var closed = new HashMap<UUID, Settlement>();
    for (var settlement : fees.settlementsOfMonth(month.atDay(1)))
      closed.put(settlement.cafeteriaId(), settlement);
    var rows = new ArrayList<Row>();
    for (var cafeteria : fees.cafeterias())
      rows.add(row(cafeteria, month, closed.get(cafeteria.id()), today));
    return new ServiceFeeMonth(month, month.equals(current), rows);
  }

  @Override
  @Transactional(isolation = Isolation.READ_COMMITTED, timeout = 15)
  public Row closeMonth(UUID user, UUID cafeteriaId, YearMonth month) {
    superAdmin(user);
    var today = today();
    var current = YearMonth.from(today);
    validMonth(month, current);
    // Only an ended month: its orders can no longer be delivered within it.
    if (!month.isBefore(current)) throw ServiceFeeException.monthOpen();
    var cafeteria =
        fees.cafeteria(Objects.requireNonNull(cafeteriaId))
            .orElseThrow(ServiceFeeException::cafeteriaNotFound);
    fees.setAuditActor(user);
    // ON CONFLICT DO NOTHING: a second close (or a race) writes and audits nothing.
    fees.closeMonth(cafeteriaId, month.atDay(1), user);
    var settlement =
        fees.settlement(cafeteriaId, month.atDay(1))
            .orElseThrow(() -> new IllegalStateException("Closed month is not readable"));
    return row(cafeteria, month, settlement, today);
  }

  @Override
  @Transactional(isolation = Isolation.READ_COMMITTED, timeout = 15)
  public Row markPaid(UUID user, UUID cafeteriaId, YearMonth month, String note) {
    var cleanNote = note == null ? null : note.strip();
    if (cleanNote != null && cleanNote.isEmpty()) cleanNote = null;
    if (cleanNote != null && cleanNote.codePointCount(0, cleanNote.length()) > MAX_NOTE_LENGTH)
      throw ServiceFeeException.invalidRequest();
    superAdmin(user);
    var today = today();
    validMonth(month, YearMonth.from(today));
    var cafeteria =
        fees.cafeteria(Objects.requireNonNull(cafeteriaId))
            .orElseThrow(ServiceFeeException::cafeteriaNotFound);
    var settlement =
        fees.lockSettlement(cafeteriaId, month.atDay(1))
            .orElseThrow(ServiceFeeException::monthNotClosed);
    if (!"PAGADA".equals(settlement.status())) {
      fees.setAuditActor(user);
      if (!fees.markPaid(cafeteriaId, month.atDay(1), time.now(), user, cleanNote))
        throw ServiceFeeException.stateChanged();
      settlement =
          fees.settlement(cafeteriaId, month.atDay(1))
              .orElseThrow(() -> new IllegalStateException("Paid month is not readable"));
    }
    return row(cafeteria, month, settlement, today);
  }

  // ---------------------------------------------------------------- admin

  @Override
  @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ, timeout = 15)
  public ServiceFeeStatement statement(UUID user) {
    if (!flag.enabled()) throw ServiceFeeException.disabled();
    var facts =
        users
            .findUserAuthorization(Objects.requireNonNull(user))
            .filter(
                u ->
                    u.active() && u.roles().equals(Set.of("ADMIN")) && u.cafeteriaIds().size() == 1)
            .orElseThrow(ServiceFeeException::forbidden);
    var cafeteriaId = facts.cafeteriaIds().getFirst();
    var cafeteria = fees.cafeteria(cafeteriaId).orElseThrow(ServiceFeeException::forbidden);
    var today = today();
    var closed = new HashMap<YearMonth, Settlement>();
    for (var settlement : fees.settlementsOf(cafeteriaId, MONTHS))
      closed.put(YearMonth.from(settlement.month()), settlement);
    var months = new ArrayList<Row>();
    for (var month = YearMonth.from(today);
        months.size() < MONTHS && !month.isBefore(ServiceFeeRules.FIRST_MONTH);
        month = month.minusMonths(1)) months.add(row(cafeteria, month, closed.get(month), today));
    int general = fees.general().feeCop();
    return new ServiceFeeStatement(
        cafeteria.id(),
        cafeteria.name(),
        cafeteria.ownFeeCop() == null ? general : cafeteria.ownFeeCop(),
        months);
  }

  // ---------------------------------------------------------------- rows

  /** A closed month is its frozen copy; an open one, the live sum. */
  private Row row(CafeteriaRow cafeteria, YearMonth month, Settlement closed, LocalDate today) {
    var current = YearMonth.from(today);
    if (closed == null) {
      var live = fees.summary(cafeteria.id(), month.atDay(1));
      return new Row(
          cafeteria.id(),
          cafeteria.name(),
          cafeteria.siteName(),
          month,
          live.deliveredOrders(),
          live.productsTotal(),
          live.feeTotal(),
          Status.ABIERTO,
          null,
          null,
          null,
          false,
          0,
          month.isBefore(current));
    }
    var status = Status.valueOf(closed.status());
    long late = status == Status.PENDIENTE ? ServiceFeeRules.daysOverdue(month, today) : 0;
    return new Row(
        cafeteria.id(),
        cafeteria.name(),
        cafeteria.siteName(),
        month,
        closed.deliveredOrders(),
        closed.productsTotal(),
        closed.feeTotal(),
        status,
        closed.closedAt(),
        closed.paidAt(),
        closed.note(),
        late > 0,
        late,
        false);
  }
}

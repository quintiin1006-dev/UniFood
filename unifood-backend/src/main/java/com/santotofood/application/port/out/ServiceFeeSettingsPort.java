package com.santotofood.application.port.out;

import com.santotofood.application.model.ServiceFeeAuditEntry;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Service fee settings and monthly settlements (033). Lock methods run inside the caller's
 * transaction. Audit rows are written by trigger; Spring only names the actor.
 */
public interface ServiceFeeSettingsPort {

  void setAuditActor(UUID actorId);

  General general();

  /** {@code FOR UPDATE}: orders reading the fee ({@code FOR SHARE}) wait for the change. */
  General lockGeneral();

  /** False when the version no longer matches. */
  boolean updateGeneral(int feeCop, int expectedVersion, Instant now, UUID actorId);

  List<CafeteriaRow> cafeterias();

  Optional<CafeteriaRow> cafeteria(UUID cafeteriaId);

  /** Creates the row (fee NULL, not audited) if needed and locks it; empty for no cafeteria. */
  Optional<OwnFee> lockCafeteriaFee(UUID cafeteriaId);

  boolean updateCafeteriaFee(
      UUID cafeteriaId, Integer feeCop, int expectedVersion, Instant now, UUID actorId);

  /** Live sum of the DELIVERED orders of that month; {@code month} is its first day. */
  Summary summary(UUID cafeteriaId, LocalDate month);

  List<Settlement> settlementsOfMonth(LocalDate month);

  List<Settlement> settlementsOf(UUID cafeteriaId, int limit);

  Optional<Settlement> settlement(UUID cafeteriaId, LocalDate month);

  Optional<Settlement> lockSettlement(UUID cafeteriaId, LocalDate month);

  /** Freezes the live sum; false when the month was already closed (nothing written). */
  boolean closeMonth(UUID cafeteriaId, LocalDate month, UUID actorId);

  /** PENDIENTE to PAGADA; false when it was not PENDIENTE. */
  boolean markPaid(UUID cafeteriaId, LocalDate month, Instant now, UUID actorId, String note);

  List<ServiceFeeAuditEntry> audit(int limit);

  record General(int feeCop, int version, Instant updatedAt) {}

  record OwnFee(Integer feeCop, int version) {}

  record CafeteriaRow(
      UUID id, String name, String siteName, boolean visible, Integer ownFeeCop, int version) {}

  record Summary(int deliveredOrders, BigDecimal productsTotal, long feeTotal) {}

  record Settlement(
      UUID cafeteriaId,
      LocalDate month,
      int deliveredOrders,
      BigDecimal productsTotal,
      long feeTotal,
      String status,
      Instant paidAt,
      String note,
      Instant closedAt) {}
}

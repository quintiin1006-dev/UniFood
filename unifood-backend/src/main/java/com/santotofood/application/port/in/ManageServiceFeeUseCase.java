package com.santotofood.application.port.in;

import com.santotofood.application.model.ServiceFeeAuditEntry;
import com.santotofood.application.model.ServiceFeeMonth;
import com.santotofood.application.model.ServiceFeeOverview;
import java.time.YearMonth;
import java.util.List;
import java.util.UUID;

/** SUPER_ADMIN: fee values, monthly settlements and their history (docs/modelo-de-negocio.md). */
public interface ManageServiceFeeUseCase {
  int MAX_AUDIT_LIMIT = 100;

  ServiceFeeOverview overview(UUID user);

  /** The current value again is a 200 without writing or auditing. */
  ServiceFeeOverview changeGeneralFee(UUID user, int feeCop, int expectedVersion);

  /** {@code feeCop} null returns the cafeteria to the general fee; 0 is no fee. */
  ServiceFeeOverview changeCafeteriaFee(
      UUID user, UUID cafeteriaId, Integer feeCop, int expectedVersion);

  ServiceFeeMonth month(UUID user, YearMonth month);

  /** Idempotent: closing a closed month returns it unchanged. */
  ServiceFeeMonth.Row closeMonth(UUID user, UUID cafeteriaId, YearMonth month);

  /** Idempotent: a PAGADA month returns unchanged. */
  ServiceFeeMonth.Row markPaid(UUID user, UUID cafeteriaId, YearMonth month, String note);

  List<ServiceFeeAuditEntry> audit(UUID user, int limit);
}

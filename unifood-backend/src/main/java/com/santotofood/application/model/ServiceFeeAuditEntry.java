package com.santotofood.application.model;

import java.time.Instant;
import java.time.LocalDate;
import java.util.Map;
import java.util.UUID;

/**
 * One row of service_fee_audit (033). {@code changedByName} is a display name, null for manual SQL;
 * never an email or an id.
 */
public record ServiceFeeAuditEntry(
    String action,
    UUID cafeteriaId,
    String cafeteriaName,
    LocalDate periodMonth,
    Map<String, Object> oldValue,
    Map<String, Object> newValue,
    Instant changedAt,
    String source,
    String changedByName) {}

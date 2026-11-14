package com.santotofood.application.model;

import java.time.Instant;
import java.util.Objects;

/**
 * One row of cafeteria_settings_audit. Values are the JSON objects the 022 trigger wrote. {@code
 * changedByName} is null for a manual SQL change; it is a display name, never an email or an id.
 */
public record CafeteriaSettingsAuditEntry(
    Setting setting,
    String oldValueJson,
    String newValueJson,
    Instant changedAt,
    String changedByName,
    Source source) {
  public enum Setting {
    VISIBILITY,
    BILLING
  }

  public enum Source {
    API,
    SQL
  }

  public CafeteriaSettingsAuditEntry {
    Objects.requireNonNull(setting);
    Objects.requireNonNull(oldValueJson);
    Objects.requireNonNull(newValueJson);
    Objects.requireNonNull(changedAt);
    Objects.requireNonNull(source);
  }
}

package com.santotofood.adapter.in.web.dto;

import com.santotofood.application.model.CafeteriaSettingsAuditEntry;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import tools.jackson.databind.json.JsonMapper;

/** Most recent first. {@code changedBy} is null for a manual SQL change and never has an email. */
public record CafeteriaSettingsAuditResponse(List<Entry> entries) {
  private static final JsonMapper JSON = JsonMapper.builder().build();

  public record Entry(
      String setting,
      Map<String, Object> oldValue,
      Map<String, Object> newValue,
      Instant changedAt,
      ChangedBy changedBy,
      String source) {}

  public record ChangedBy(String name) {}

  @SuppressWarnings("unchecked")
  private static Map<String, Object> value(String json) {
    return JSON.readValue(json, Map.class);
  }

  public static CafeteriaSettingsAuditResponse from(List<CafeteriaSettingsAuditEntry> entries) {
    return new CafeteriaSettingsAuditResponse(
        entries.stream()
            .map(
                entry ->
                    new Entry(
                        entry.setting().name(),
                        value(entry.oldValueJson()),
                        value(entry.newValueJson()),
                        entry.changedAt(),
                        entry.changedByName() == null ? null : new ChangedBy(entry.changedByName()),
                        entry.source().name()))
            .toList());
  }
}

package com.santotofood.adapter.out.persistence;

import com.santotofood.application.model.CafeteriaBilling;
import com.santotofood.application.model.CafeteriaSettings;
import com.santotofood.application.model.CafeteriaSettingsAuditEntry;
import com.santotofood.application.model.SuperAdminInstitution;
import com.santotofood.application.port.out.CafeteriaSettingsPort;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import org.springframework.core.io.ClassPathResource;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

@Component
public class CafeteriaSettingsPersistenceAdapter implements CafeteriaSettingsPort {
  private static final String GUARD_EXCLUSIVE = sql("lock-guard-exclusive"),
      GUARD_SHARED = sql("lock-guard-shared"),
      ACTOR = sql("set-audit-actor"),
      LOCK = sql("lock-settings"),
      VISIBILITY = sql("update-visibility"),
      CHECK_PROFILES = sql("check-cafeteria-profiles"),
      BILLING = sql("update-billing"),
      CAFETERIA = sql("cafeteria"),
      EXISTS = sql("cafeteria-exists"),
      AUDIT = sql("audit");
  private final JdbcTemplate jdbc;

  public CafeteriaSettingsPersistenceAdapter(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  private static String sql(String name) {
    try {
      return new ClassPathResource("sql/super-admin/" + name + ".sql")
          .getContentAsString(StandardCharsets.UTF_8);
    } catch (IOException exception) {
      throw new IllegalStateException("Cafeteria settings query unavailable", exception);
    }
  }

  private static CafeteriaBilling billing(ResultSet row) throws SQLException {
    return CafeteriaBilling.stored(
        row.getString("billing_model"),
        row.getObject("per_order_fee_cop", Integer.class),
        row.getObject("subscription_fee_cop", Integer.class));
  }

  @Override
  public void lockAuthorizationGuard(boolean exclusive) {
    jdbc.queryForObject(exclusive ? GUARD_EXCLUSIVE : GUARD_SHARED, Boolean.class);
  }

  @Override
  public void setAuditActor(UUID actorId) {
    jdbc.queryForObject(ACTOR, String.class, Objects.requireNonNull(actorId).toString());
  }

  @Override
  public Optional<CafeteriaSettings> lockSettings(UUID cafeteriaId) {
    return jdbc
        .query(
            LOCK,
            (row, index) ->
                new CafeteriaSettings(
                    row.getBoolean("visible"),
                    row.getBoolean("has_active_admin"),
                    billing(row),
                    row.getInt("billing_version")),
            cafeteriaId)
        .stream()
        .findFirst();
  }

  @Override
  public boolean updateVisibility(UUID cafeteriaId, boolean visible) {
    if (jdbc.update(VISIBILITY, visible, cafeteriaId) != 1)
      throw new IllegalStateException("Locked cafeteria disappeared");
    try {
      // Runs the deferred 009 check now, where its failure is still a business outcome.
      jdbc.execute(CHECK_PROFILES);
      return true;
    } catch (DataIntegrityViolationException exception) {
      if (exception.getMessage() != null
          && exception.getMessage().contains("cafeteria_profile_cardinality")) return false;
      throw exception;
    }
  }

  @Override
  public boolean updateBilling(
      UUID cafeteriaId,
      CafeteriaBilling billing,
      int expectedVersion,
      Instant updatedAt,
      UUID updatedBy) {
    return jdbc.update(
            BILLING,
            billing.model().name(),
            billing.perOrderFeeCop(),
            billing.subscriptionFeeCop(),
            Timestamp.from(updatedAt),
            updatedBy,
            cafeteriaId,
            expectedVersion)
        == 1;
  }

  @Override
  public Optional<SuperAdminInstitution.Cafeteria> findCafeteria(UUID cafeteriaId) {
    return jdbc
        .query(
            CAFETERIA,
            (row, index) ->
                new SuperAdminInstitution.Cafeteria(
                    row.getObject("id", UUID.class),
                    row.getString("name"),
                    row.getBoolean("visible"),
                    row.getBoolean("has_active_admin"),
                    billing(row),
                    row.getInt("billing_version")),
            cafeteriaId)
        .stream()
        .findFirst();
  }

  @Override
  public boolean cafeteriaExists(UUID cafeteriaId) {
    return Boolean.TRUE.equals(jdbc.queryForObject(EXISTS, Boolean.class, cafeteriaId));
  }

  @Override
  public List<CafeteriaSettingsAuditEntry> findAudit(UUID cafeteriaId, int limit) {
    return jdbc.query(
        AUDIT,
        (row, index) ->
            new CafeteriaSettingsAuditEntry(
                CafeteriaSettingsAuditEntry.Setting.valueOf(row.getString("setting")),
                row.getString("old_value"),
                row.getString("new_value"),
                row.getObject("changed_at", OffsetDateTime.class).toInstant(),
                row.getString("changed_by_name"),
                CafeteriaSettingsAuditEntry.Source.valueOf(row.getString("source"))),
        cafeteriaId,
        limit);
  }
}

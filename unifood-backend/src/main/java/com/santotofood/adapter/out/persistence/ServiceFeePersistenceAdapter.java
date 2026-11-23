package com.santotofood.adapter.out.persistence;

import com.santotofood.application.model.ServiceFeeAuditEntry;
import com.santotofood.application.port.out.ServiceFeeQueryPort;
import com.santotofood.application.port.out.ServiceFeeSettingsPort;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Types;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Component;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.json.JsonMapper;

/** Service fee settings, the fee of an order and the monthly settlements (033). */
@Component
public class ServiceFeePersistenceAdapter implements ServiceFeeQueryPort, ServiceFeeSettingsPort {
  private static final String EFFECTIVE = sql("effective-fee"),
      LOCK_EFFECTIVE = sql("lock-effective-fee"),
      GENERAL = sql("general"),
      LOCK_GENERAL = sql("lock-general"),
      UPDATE_GENERAL = sql("update-general"),
      ENSURE_OWN = sql("ensure-cafeteria-fee"),
      LOCK_OWN = sql("lock-cafeteria-fee"),
      UPDATE_OWN = sql("update-cafeteria-fee"),
      CAFETERIAS = sql("cafeterias"),
      CAFETERIA = sql("cafeteria"),
      SUMMARY = sql("summary"),
      OF_MONTH = sql("settlements-of-month"),
      OF_CAFETERIA = sql("settlements-of-cafeteria"),
      SETTLEMENT = sql("settlement"),
      LOCK_SETTLEMENT = sql("lock-settlement"),
      CLOSE = sql("close-month"),
      PAY = sql("mark-paid"),
      AUDIT = sql("audit"),
      ACTOR = sql("set-audit-actor");

  private static final JsonMapper JSON = JsonMapper.builder().build();
  private static final TypeReference<Map<String, Object>> OBJECT = new TypeReference<>() {};

  private static final RowMapper<CafeteriaRow> CAFETERIA_ROW =
      (row, number) ->
          new CafeteriaRow(
              row.getObject("cafeteria_id", UUID.class),
              row.getString("cafeteria_name"),
              row.getString("site_name"),
              row.getBoolean("visible"),
              (Integer) row.getObject("fee_cop"),
              row.getInt("version"));

  private static final RowMapper<General> GENERAL_ROW =
      (row, number) ->
          new General(row.getInt("fee_cop"), row.getInt("version"), instant(row, "updated_at"));

  private static final RowMapper<Settlement> SETTLEMENT_ROW =
      (row, number) ->
          new Settlement(
              row.getObject("cafeteria_id", UUID.class),
              row.getObject("period_month", LocalDate.class),
              row.getInt("delivered_orders_count"),
              row.getBigDecimal("products_total"),
              row.getLong("fee_total"),
              row.getString("status"),
              instant(row, "paid_at"),
              row.getString("note"),
              instant(row, "created_at"));

  private final JdbcTemplate jdbc;

  public ServiceFeePersistenceAdapter(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  @Override
  public int effectiveFee(UUID cafeteriaId) {
    return fee(EFFECTIVE, cafeteriaId);
  }

  @Override
  public int lockEffectiveFee(UUID cafeteriaId) {
    return fee(LOCK_EFFECTIVE, cafeteriaId);
  }

  private int fee(String query, UUID cafeteriaId) {
    // 033 seeds the general row and no trigger deletes it: a missing row is a broken database.
    Integer fee = jdbc.queryForObject(query, Integer.class, Objects.requireNonNull(cafeteriaId));
    return Objects.requireNonNull(fee, "Service fee settings are missing");
  }

  @Override
  public void setAuditActor(UUID actorId) {
    jdbc.queryForObject(ACTOR, String.class, Objects.requireNonNull(actorId).toString());
  }

  @Override
  public General general() {
    return jdbc.queryForObject(GENERAL, GENERAL_ROW);
  }

  @Override
  public General lockGeneral() {
    return jdbc.queryForObject(LOCK_GENERAL, GENERAL_ROW);
  }

  @Override
  public boolean updateGeneral(int feeCop, int expectedVersion, Instant now, UUID actorId) {
    return jdbc.update(UPDATE_GENERAL, feeCop, utc(now), actorId, expectedVersion) == 1;
  }

  @Override
  public List<CafeteriaRow> cafeterias() {
    return jdbc.query(CAFETERIAS, CAFETERIA_ROW);
  }

  @Override
  public Optional<CafeteriaRow> cafeteria(UUID cafeteriaId) {
    return jdbc.query(CAFETERIA, CAFETERIA_ROW, cafeteriaId).stream().findFirst();
  }

  @Override
  public Optional<OwnFee> lockCafeteriaFee(UUID cafeteriaId) {
    jdbc.update(ENSURE_OWN, cafeteriaId);
    return jdbc
        .query(
            LOCK_OWN,
            (row, number) -> new OwnFee((Integer) row.getObject("fee_cop"), row.getInt("version")),
            cafeteriaId)
        .stream()
        .findFirst();
  }

  @Override
  public boolean updateCafeteriaFee(
      UUID cafeteriaId, Integer feeCop, int expectedVersion, Instant now, UUID actorId) {
    return jdbc.update(
            UPDATE_OWN,
            statement -> {
              if (feeCop == null) statement.setNull(1, Types.INTEGER);
              else statement.setInt(1, feeCop);
              statement.setObject(2, utc(now));
              statement.setObject(3, actorId);
              statement.setObject(4, cafeteriaId);
              statement.setInt(5, expectedVersion);
            })
        == 1;
  }

  @Override
  public Summary summary(UUID cafeteriaId, LocalDate month) {
    return jdbc.queryForObject(
        SUMMARY,
        (row, number) ->
            new Summary(
                row.getInt("delivered_orders_count"),
                row.getBigDecimal("products_total"),
                row.getLong("fee_total")),
        cafeteriaId,
        month);
  }

  @Override
  public List<Settlement> settlementsOfMonth(LocalDate month) {
    return jdbc.query(OF_MONTH, SETTLEMENT_ROW, month);
  }

  @Override
  public List<Settlement> settlementsOf(UUID cafeteriaId, int limit) {
    return jdbc.query(OF_CAFETERIA, SETTLEMENT_ROW, cafeteriaId, limit);
  }

  @Override
  public Optional<Settlement> settlement(UUID cafeteriaId, LocalDate month) {
    return jdbc.query(SETTLEMENT, SETTLEMENT_ROW, cafeteriaId, month).stream().findFirst();
  }

  @Override
  public Optional<Settlement> lockSettlement(UUID cafeteriaId, LocalDate month) {
    return jdbc.query(LOCK_SETTLEMENT, SETTLEMENT_ROW, cafeteriaId, month).stream().findFirst();
  }

  @Override
  public boolean closeMonth(UUID cafeteriaId, LocalDate month, UUID actorId) {
    return jdbc.update(CLOSE, cafeteriaId, month, actorId, cafeteriaId, month) == 1;
  }

  @Override
  public boolean markPaid(
      UUID cafeteriaId, LocalDate month, Instant now, UUID actorId, String note) {
    return jdbc.update(PAY, utc(now), actorId, note, cafeteriaId, month) == 1;
  }

  @Override
  public List<ServiceFeeAuditEntry> audit(int limit) {
    return jdbc.query(
        AUDIT,
        (row, number) ->
            new ServiceFeeAuditEntry(
                row.getString("action"),
                row.getObject("cafeteria_id", UUID.class),
                row.getString("cafeteria_name"),
                row.getObject("period_month", LocalDate.class),
                json(row.getString("old_value")),
                json(row.getString("new_value")),
                instant(row, "changed_at"),
                row.getString("source"),
                row.getString("changed_by_name")),
        limit);
  }

  private static Map<String, Object> json(String value) {
    return value == null ? Map.of() : JSON.readValue(value, OBJECT);
  }

  private static OffsetDateTime utc(Instant instant) {
    return instant.atOffset(ZoneOffset.UTC);
  }

  private static Instant instant(ResultSet row, String column) throws SQLException {
    var value = row.getObject(column, OffsetDateTime.class);
    return value == null ? null : value.toInstant();
  }

  private static String sql(String name) {
    try {
      return new ClassPathResource("sql/service-fee/" + name + ".sql")
          .getContentAsString(StandardCharsets.UTF_8);
    } catch (IOException exception) {
      throw new IllegalStateException("Service fee SQL is unavailable", exception);
    }
  }
}

package com.santotofood.adapter.out.persistence;

import com.santotofood.application.model.CashSession;
import com.santotofood.application.model.CashViews;
import com.santotofood.application.port.out.CashSessionPort;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.sql.Date;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

@Component
public class CashSessionPersistenceAdapter implements CashSessionPort {
  private static final String LOCK_TIMEOUT = sql("lock-timeout"),
      ACTOR = sql("set-audit-actor"),
      EXISTS = sql("cafeteria-exists"),
      ENSURE_SETTINGS = sql("ensure-settings"),
      LOCK_SETTINGS = sql("lock-settings"),
      SETTINGS = sql("settings"),
      NEXT_SEQUENCE = sql("next-sequence"),
      UPDATE_TOLERANCE = sql("update-tolerance"),
      SESSION = sql("session-select"),
      LOCK_SESSION = sql("lock-session"),
      SHIFT_USED = sql("shift-used"),
      INSERT_SESSION = sql("insert-session"),
      LATEST_SEQUENCE = sql("latest-sequence"),
      SALES = sql("sales"),
      MOVEMENT_TOTALS = sql("movement-totals"),
      PENDING = sql("pending-orders"),
      MOVEMENT = sql("movement-select"),
      INSERT_MOVEMENT = sql("insert-movement"),
      DELETE_LINES = sql("delete-count-lines"),
      INSERT_LINE = sql("insert-count-line"),
      LINES = sql("count-lines"),
      CLOSE = sql("close-session"),
      REOPEN = sql("reopen-session"),
      STALE = sql("stale-sessions"),
      UNSESSIONED = sql("unsessioned");
  private static final int MAX_LIST = 500;
  private final JdbcTemplate jdbc;

  public CashSessionPersistenceAdapter(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  private static String sql(String name) {
    try {
      return new ClassPathResource("sql/cash/" + name + ".sql")
          .getContentAsString(StandardCharsets.UTF_8)
          .strip();
    } catch (IOException exception) {
      throw new IllegalStateException("Cash query unavailable", exception);
    }
  }

  private static Instant instant(ResultSet row, String column) throws SQLException {
    var value = row.getObject(column, OffsetDateTime.class);
    return value == null ? null : value.toInstant();
  }

  private static Long nullableLong(ResultSet row, String column) throws SQLException {
    return row.getObject(column, Long.class);
  }

  private static CashSession session(ResultSet row, int index) throws SQLException {
    return new CashSession(
        row.getObject("id", UUID.class),
        row.getObject("cafeteria_id", UUID.class),
        row.getString("cafeteria_name"),
        CashSession.Shift.valueOf(row.getString("shift")),
        row.getObject("business_date", LocalDate.class),
        row.getInt("sequence_number"),
        CashSession.Status.valueOf(row.getString("status")),
        row.getLong("opening_float"),
        instant(row, "opened_at"),
        row.getString("opened_by_name"),
        instant(row, "closed_at"),
        row.getString("closed_by_name"),
        nullableLong(row, "sales_cash"),
        nullableLong(row, "income_total"),
        nullableLong(row, "expense_total"),
        nullableLong(row, "expected_cash"),
        nullableLong(row, "counted_cash"),
        nullableLong(row, "difference"),
        row.getObject("tolerance_cop", Integer.class),
        row.getString("note"),
        row.getObject("pending_orders_at_close", Integer.class),
        row.getObject("forced_close", Boolean.class),
        row.getInt("reopen_count"),
        instant(row, "reopened_at"),
        row.getString("reopened_by_name"),
        row.getString("reopen_reason"),
        row.getInt("version"));
  }

  private static CashViews.Movement movement(ResultSet row, int index) throws SQLException {
    return new CashViews.Movement(
        row.getObject("id", UUID.class),
        CashViews.Movement.Kind.valueOf(row.getString("kind")),
        row.getLong("amount"),
        row.getString("reason"),
        instant(row, "created_at"),
        row.getString("created_by_name"));
  }

  private static Settings settings(ResultSet row, int index) throws SQLException {
    return new Settings(row.getInt("tolerance_cop"), row.getInt("version"));
  }

  @Override
  public void setLockTimeout() {
    jdbc.queryForObject(LOCK_TIMEOUT, String.class);
  }

  @Override
  public void setAuditActor(UUID actorId) {
    jdbc.queryForObject(ACTOR, String.class, Objects.requireNonNull(actorId).toString());
  }

  @Override
  public boolean cafeteriaExists(UUID cafeteriaId) {
    return Boolean.TRUE.equals(jdbc.queryForObject(EXISTS, Boolean.class, cafeteriaId));
  }

  @Override
  public Optional<Settings> lockSettings(UUID cafeteriaId) {
    // 028 seeds every cafeteria and its trigger covers new ones; this only guards the gap.
    jdbc.update(ENSURE_SETTINGS, cafeteriaId);
    return jdbc.query(LOCK_SETTINGS, CashSessionPersistenceAdapter::settings, cafeteriaId).stream()
        .findFirst();
  }

  @Override
  public Optional<Settings> findSettings(UUID cafeteriaId) {
    return jdbc.query(SETTINGS, CashSessionPersistenceAdapter::settings, cafeteriaId).stream()
        .findFirst();
  }

  @Override
  public int nextSequence(UUID cafeteriaId) {
    return jdbc.queryForObject(NEXT_SEQUENCE, Integer.class, cafeteriaId);
  }

  @Override
  public boolean updateTolerance(
      UUID cafeteriaId, int toleranceCop, int expectedVersion, Instant at, UUID by) {
    return jdbc.update(
            UPDATE_TOLERANCE, toleranceCop, Timestamp.from(at), by, cafeteriaId, expectedVersion)
        == 1;
  }

  @Override
  public Optional<CashSession> findOpenSession(UUID cafeteriaId) {
    return jdbc
        .query(
            SESSION + " WHERE s.cafeteria_id = ? AND s.status IN ('OPEN', 'REOPENED')",
            CashSessionPersistenceAdapter::session,
            cafeteriaId)
        .stream()
        .findFirst();
  }

  @Override
  public boolean shiftUsed(UUID cafeteriaId, LocalDate businessDate, CashSession.Shift shift) {
    return Boolean.TRUE.equals(
        jdbc.queryForObject(
            SHIFT_USED, Boolean.class, cafeteriaId, Date.valueOf(businessDate), shift.name()));
  }

  @Override
  public UUID insertSession(NewSession session) {
    return jdbc.queryForObject(
        INSERT_SESSION,
        UUID.class,
        session.cafeteriaId(),
        session.shift().name(),
        Date.valueOf(session.businessDate()),
        session.sequenceNumber(),
        session.openingFloat(),
        session.openedBy(),
        Timestamp.from(session.openedAt()));
  }

  @Override
  public Optional<CashSession> lockSession(UUID sessionId, UUID cafeteriaId) {
    if (jdbc.query(LOCK_SESSION, (row, index) -> 1, sessionId, cafeteriaId).isEmpty())
      return Optional.empty();
    return findSession(sessionId, cafeteriaId);
  }

  @Override
  public Optional<CashSession> findSession(UUID sessionId, UUID cafeteriaId) {
    return jdbc
        .query(
            SESSION + " WHERE s.id = ? AND (CAST(? AS uuid) IS NULL OR s.cafeteria_id = ?)",
            CashSessionPersistenceAdapter::session,
            sessionId,
            cafeteriaId,
            cafeteriaId)
        .stream()
        .findFirst();
  }

  @Override
  public int latestSequence(UUID cafeteriaId) {
    return jdbc.queryForObject(LATEST_SEQUENCE, Integer.class, cafeteriaId);
  }

  @Override
  public Sales sales(UUID cafeteriaId, Instant from, Instant to) {
    return jdbc.queryForObject(
        SALES,
        (row, index) ->
            new Sales(
                row.getBigDecimal("amount"), row.getLong("orders"), row.getBoolean("fractional")),
        cafeteriaId,
        Timestamp.from(from),
        Timestamp.from(to));
  }

  @Override
  public MovementTotals movementTotals(UUID sessionId) {
    return jdbc.queryForObject(
        MOVEMENT_TOTALS,
        (row, index) -> new MovementTotals(row.getLong("income"), row.getLong("expense")),
        sessionId);
  }

  @Override
  public List<CashViews.PendingOrder> pendingOrders(UUID cafeteriaId, boolean lock) {
    return jdbc.query(
        lock ? PENDING + "\nFOR SHARE OF o" : PENDING,
        (row, index) ->
            new CashViews.PendingOrder(
                row.getObject("id", UUID.class),
                row.getString("status"),
                row.getString("client_name"),
                instant(row, "created_at")),
        cafeteriaId);
  }

  @Override
  public Optional<CashViews.Movement> findMovementByRequest(UUID sessionId, UUID requestId) {
    return jdbc
        .query(
            MOVEMENT + " WHERE m.session_id = ? AND m.request_id = ?",
            CashSessionPersistenceAdapter::movement,
            sessionId,
            requestId)
        .stream()
        .findFirst();
  }

  @Override
  public void insertMovement(
      UUID sessionId,
      UUID requestId,
      CashViews.Movement.Kind kind,
      long amount,
      String reason,
      UUID createdBy,
      Instant createdAt) {
    jdbc.update(
        INSERT_MOVEMENT,
        sessionId,
        requestId,
        kind.name(),
        amount,
        reason,
        createdBy,
        Timestamp.from(createdAt));
  }

  @Override
  public List<CashViews.Movement> movements(UUID sessionId) {
    return jdbc.query(
        MOVEMENT + " WHERE m.session_id = ? ORDER BY m.created_at, m.id",
        CashSessionPersistenceAdapter::movement,
        sessionId);
  }

  @Override
  public void replaceCountLines(UUID sessionId, Map<Integer, Integer> quantities) {
    jdbc.update(DELETE_LINES, sessionId);
    List<Object[]> rows = new ArrayList<>();
    for (var line : quantities.entrySet())
      if (line.getValue() > 0) rows.add(new Object[] {sessionId, line.getKey(), line.getValue()});
    if (!rows.isEmpty()) jdbc.batchUpdate(INSERT_LINE, rows);
  }

  @Override
  public Map<Integer, Integer> countLines(UUID sessionId) {
    Map<Integer, Integer> lines = new LinkedHashMap<>();
    jdbc.query(
        LINES,
        row -> {
          lines.put(row.getInt("denomination"), row.getInt("quantity"));
        },
        sessionId);
    return lines;
  }

  @Override
  public boolean close(Closing closing) {
    return jdbc.update(
            CLOSE,
            closing.closedBy(),
            Timestamp.from(closing.closedAt()),
            closing.salesCash(),
            closing.incomeTotal(),
            closing.expenseTotal(),
            closing.expectedCash(),
            closing.countedCash(),
            closing.difference(),
            closing.toleranceCop(),
            closing.note(),
            closing.pendingOrders(),
            closing.forced(),
            closing.sessionId(),
            closing.expectedVersion())
        == 1;
  }

  @Override
  public boolean reopen(UUID sessionId, int expectedVersion, UUID by, Instant at, String reason) {
    return jdbc.update(REOPEN, by, Timestamp.from(at), reason, sessionId, expectedVersion) == 1;
  }

  @Override
  public List<CashSession> list(UUID cafeteriaId, LocalDate from, LocalDate to) {
    return jdbc.query(
        SESSION
            + " WHERE (CAST(? AS uuid) IS NULL OR s.cafeteria_id = ?)"
            + " AND s.business_date BETWEEN ? AND ?"
            + " ORDER BY s.business_date DESC, c.name, s.sequence_number DESC LIMIT "
            + MAX_LIST,
        CashSessionPersistenceAdapter::session,
        cafeteriaId,
        cafeteriaId,
        Date.valueOf(from),
        Date.valueOf(to));
  }

  @Override
  public List<CashViews.StaleSession> staleSessions(UUID cafeteriaId, LocalDate today) {
    return jdbc.query(
        STALE,
        (row, index) ->
            new CashViews.StaleSession(
                row.getObject("id", UUID.class),
                row.getObject("cafeteria_id", UUID.class),
                row.getString("cafeteria_name"),
                row.getObject("business_date", LocalDate.class),
                CashSession.Shift.valueOf(row.getString("shift")),
                instant(row, "opened_at")),
        Date.valueOf(today),
        cafeteriaId,
        cafeteriaId);
  }

  @Override
  public CashViews.Unsessioned unsessioned(UUID cafeteriaId, Instant from, Instant to) {
    return jdbc.queryForObject(
        UNSESSIONED,
        (row, index) -> new CashViews.Unsessioned(row.getLong("orders"), row.getLong("amount")),
        cafeteriaId,
        Timestamp.from(from),
        Timestamp.from(to));
  }
}

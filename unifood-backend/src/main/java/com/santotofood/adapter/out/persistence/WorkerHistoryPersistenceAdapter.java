package com.santotofood.adapter.out.persistence;

import com.santotofood.application.model.WorkerHistory;
import com.santotofood.application.port.out.WorkerHistoryQueryPort;
import com.santotofood.domain.model.OrderStatus;
import java.io.IOException;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Types;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Component;

@Component
public class WorkerHistoryPersistenceAdapter implements WorkerHistoryQueryPort {
  private static final String HISTORY = querySql();
  private final NamedParameterJdbcTemplate jdbc;

  public WorkerHistoryPersistenceAdapter(JdbcTemplate jdbc) {
    this.jdbc = new NamedParameterJdbcTemplate(jdbc);
  }

  @Override
  public Result findCompleted(Query query) {
    Objects.requireNonNull(query.cafeteriaId());
    if (!query.start().isBefore(query.end()))
      throw new IllegalArgumentException("Invalid worker history interval");
    var after = query.after();
    var parameters =
        new MapSqlParameterSource()
            .addValue("cafeteriaId", query.cafeteriaId(), Types.OTHER)
            .addValue(
                "dayStart", query.start().atOffset(ZoneOffset.UTC), Types.TIMESTAMP_WITH_TIMEZONE)
            .addValue(
                "monthStart",
                query.monthStart().atOffset(ZoneOffset.UTC),
                Types.TIMESTAMP_WITH_TIMEZONE)
            .addValue(
                "nextDayStart", query.end().atOffset(ZoneOffset.UTC), Types.TIMESTAMP_WITH_TIMEZONE)
            .addValue(
                "status", query.status() == null ? null : query.status().name(), Types.VARCHAR)
            .addValue("search", query.search(), Types.VARCHAR)
            .addValue(
                "searchStates",
                query.searchStatuses().isEmpty() ? List.of("") : query.searchStatuses())
            .addValue(
                "cursorAt",
                (after == null ? query.end() : after.completedAt()).atOffset(ZoneOffset.UTC),
                Types.TIMESTAMP_WITH_TIMEZONE)
            .addValue(
                "cursorId",
                after == null
                    ? UUID.fromString("ffffffff-ffff-ffff-ffff-ffffffffffff")
                    : after.id(),
                Types.OTHER)
            .addValue("limit", query.limit(), Types.INTEGER);
    return jdbc.query(
        HISTORY,
        parameters,
        rows -> {
          // The metadata LEFT JOIN guarantees a row even for an empty filtered page.
          if (!rows.next()) throw new IllegalStateException("Missing history metadata");
          boolean hasHistory = rows.getBoolean("has_history");
          return new Result(read(rows), hasHistory);
        });
  }

  private static List<WorkerHistory.Entry> read(ResultSet rows) throws SQLException {
    var orders = new LinkedHashMap<UUID, EntryBuilder>();
    do {
      if (rows.getObject("id") == null) continue;
      UUID id = Objects.requireNonNull(rows.getObject("id", UUID.class));
      var status = OrderStatus.valueOf(rows.getString("status"));
      var completedAt = rows.getObject("completed_at", OffsetDateTime.class).toInstant();
      var total = Objects.requireNonNull(rows.getBigDecimal("total"));
      String clientName = rows.getString("client_name");
      var entry = orders.get(id);
      if (entry == null) {
        entry = new EntryBuilder(id, clientName, status, completedAt, total);
        orders.put(id, entry);
      } else if (entry.status != status
          || !Objects.equals(entry.clientName, clientName)
          || !entry.completedAt.equals(completedAt)
          || entry.total.compareTo(total) != 0) {
        throw new IllegalStateException("Inconsistent worker history projection");
      }
      UUID itemId = rows.getObject("item_id", UUID.class);
      String name = rows.getString("item_name");
      Integer quantity = rows.getObject("item_quantity", Integer.class);
      BigDecimal price = rows.getBigDecimal("item_unit_price");
      BigDecimal subtotal = rows.getBigDecimal("item_subtotal");
      if (itemId == null) {
        if (name != null || quantity != null || price != null || subtotal != null)
          throw new IllegalStateException("Incomplete worker history item");
      } else {
        entry.items.add(
            new WorkerHistory.Item(name, Objects.requireNonNull(quantity), price, subtotal));
      }
    } while (rows.next());
    return orders.values().stream().map(EntryBuilder::build).toList();
  }

  private static final class EntryBuilder {
    final UUID id;
    final String clientName;
    final OrderStatus status;
    final Instant completedAt;
    final BigDecimal total;
    final List<WorkerHistory.Item> items = new ArrayList<>();

    EntryBuilder(
        UUID id, String clientName, OrderStatus status, Instant completedAt, BigDecimal total) {
      this.id = id;
      this.clientName = clientName;
      this.status = status;
      this.completedAt = completedAt;
      this.total = total;
    }

    WorkerHistory.Entry build() {
      return new WorkerHistory.Entry(id, clientName, status, completedAt, total, items);
    }
  }

  private static String querySql() {
    try {
      return new ClassPathResource("sql/worker-history/history.sql")
          .getContentAsString(StandardCharsets.UTF_8);
    } catch (IOException exception) {
      throw new IllegalStateException("Worker history query unavailable", exception);
    }
  }
}

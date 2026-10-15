package com.santotofood.adapter.out.persistence;

import com.santotofood.application.model.TodayWorkerHistory;
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
  private static final String TODAY = querySql();
  private final NamedParameterJdbcTemplate jdbc;

  public WorkerHistoryPersistenceAdapter(JdbcTemplate jdbc) {
    this.jdbc = new NamedParameterJdbcTemplate(jdbc);
  }

  @Override
  public List<TodayWorkerHistory.Entry> findCompleted(
      UUID authorizedCafeteriaId, Instant dayStart, Instant nextDayStart) {
    Objects.requireNonNull(authorizedCafeteriaId);
    Objects.requireNonNull(dayStart);
    Objects.requireNonNull(nextDayStart);
    if (!dayStart.isBefore(nextDayStart))
      throw new IllegalArgumentException("Invalid worker history interval");
    var parameters =
        new MapSqlParameterSource()
            .addValue("cafeteriaId", authorizedCafeteriaId, Types.OTHER)
            .addValue("dayStart", dayStart.atOffset(ZoneOffset.UTC), Types.TIMESTAMP_WITH_TIMEZONE)
            .addValue(
                "nextDayStart",
                nextDayStart.atOffset(ZoneOffset.UTC),
                Types.TIMESTAMP_WITH_TIMEZONE);
    return jdbc.query(TODAY, parameters, WorkerHistoryPersistenceAdapter::read);
  }

  private static List<TodayWorkerHistory.Entry> read(ResultSet rows) throws SQLException {
    var orders = new LinkedHashMap<UUID, EntryBuilder>();
    while (rows.next()) {
      UUID id = Objects.requireNonNull(rows.getObject("id", UUID.class));
      var status = OrderStatus.valueOf(rows.getString("status"));
      var completedAt = rows.getObject("completed_at", OffsetDateTime.class).toInstant();
      var total = Objects.requireNonNull(rows.getBigDecimal("total"));
      var entry = orders.get(id);
      if (entry == null) {
        entry = new EntryBuilder(id, status, completedAt, total);
        orders.put(id, entry);
      } else if (entry.status != status
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
            new TodayWorkerHistory.Item(name, Objects.requireNonNull(quantity), price, subtotal));
      }
    }
    return orders.values().stream().map(EntryBuilder::build).toList();
  }

  private static final class EntryBuilder {
    final UUID id;
    final OrderStatus status;
    final Instant completedAt;
    final BigDecimal total;
    final List<TodayWorkerHistory.Item> items = new ArrayList<>();

    EntryBuilder(UUID id, OrderStatus status, Instant completedAt, BigDecimal total) {
      this.id = id;
      this.status = status;
      this.completedAt = completedAt;
      this.total = total;
    }

    TodayWorkerHistory.Entry build() {
      return new TodayWorkerHistory.Entry(id, status, completedAt, total, items);
    }
  }

  private static String querySql() {
    try {
      return new ClassPathResource("sql/worker-history/today.sql")
          .getContentAsString(StandardCharsets.UTF_8);
    } catch (IOException exception) {
      throw new IllegalStateException("Worker history query unavailable", exception);
    }
  }
}

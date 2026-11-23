package com.santotofood.adapter.out.persistence;

import com.santotofood.application.model.OrderNotice;
import com.santotofood.application.model.OrderNoticeKind;
import com.santotofood.application.port.out.OrderNoticePort;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import org.springframework.core.io.ClassPathResource;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronizationManager;

@Component
public class OrderNoticePersistenceAdapter implements OrderNoticePort {
  private static final String INSERT = sql("insert");
  private static final String RECENT = sql("recent");
  private static final String MARK_READ = sql("mark-read");

  private static final RowMapper<OrderNotice> NOTICE =
      (row, index) ->
          new OrderNotice(
              row.getObject("id", UUID.class),
              OrderNoticeKind.valueOf(row.getString("kind")),
              row.getInt("sequence"),
              row.getObject("order_id", UUID.class),
              row.getBoolean("order_active"),
              row.getObject("created_at", OffsetDateTime.class).toInstant(),
              row.getBoolean("is_read"));

  private final JdbcTemplate jdbc;

  public OrderNoticePersistenceAdapter(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  /**
   * Inside the transition's transaction the insert runs under a savepoint: a failure (for example
   * the table missing before migration 034) rolls back only the notice, and the transaction stays
   * usable for the order change. The failure is then rethrown for the caller to log.
   */
  @Override
  public void record(UUID orderId, OrderNoticeKind kind, int sequence, Instant at) {
    Objects.requireNonNull(orderId);
    Objects.requireNonNull(kind);
    Objects.requireNonNull(at);
    Object[] arguments = {
      kind.name(), sequence, OffsetDateTime.ofInstant(at, ZoneOffset.UTC), orderId
    };
    if (!TransactionSynchronizationManager.isActualTransactionActive()) {
      jdbc.update(INSERT, arguments);
      return;
    }
    jdbc.execute("SAVEPOINT order_notice");
    try {
      jdbc.update(INSERT, arguments);
    } catch (DataAccessException failure) {
      jdbc.execute("ROLLBACK TO SAVEPOINT order_notice");
      throw failure;
    }
    jdbc.execute("RELEASE SAVEPOINT order_notice");
  }

  @Override
  public List<OrderNotice> findRecent(UUID userId, Instant since, int limit) {
    Objects.requireNonNull(userId);
    return jdbc.query(
        RECENT, NOTICE, userId, OffsetDateTime.ofInstant(since, ZoneOffset.UTC), limit);
  }

  @Override
  public int markRead(UUID userId, Instant at) {
    Objects.requireNonNull(userId);
    return jdbc.update(MARK_READ, OffsetDateTime.ofInstant(at, ZoneOffset.UTC), userId);
  }

  private static String sql(String name) {
    try {
      return new ClassPathResource("sql/order-notices/" + name + ".sql")
          .getContentAsString(StandardCharsets.UTF_8);
    } catch (IOException exception) {
      throw new IllegalStateException("Order notice query unavailable", exception);
    }
  }
}

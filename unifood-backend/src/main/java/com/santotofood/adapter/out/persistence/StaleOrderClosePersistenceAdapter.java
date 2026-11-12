package com.santotofood.adapter.out.persistence;

import com.santotofood.application.port.out.StaleOrderClosePort;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.ZoneOffset;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

@Component
public class StaleOrderClosePersistenceAdapter implements StaleOrderClosePort {
  private static final String CANCEL_PENDING = sql("cancel-stale-pending.sql");
  private static final String NOT_COLLECT = sql("not-collect-stale.sql");
  private final JdbcTemplate jdbc;

  public StaleOrderClosePersistenceAdapter(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  @Override
  public int cancelStalePending(Instant dayStart, Instant closedAt) {
    return jdbc.update(
        CANCEL_PENDING, dayStart.atOffset(ZoneOffset.UTC), closedAt.atOffset(ZoneOffset.UTC));
  }

  @Override
  public int markStaleNotCollected(Instant dayStart, Instant closedAt) {
    return jdbc.update(
        NOT_COLLECT, dayStart.atOffset(ZoneOffset.UTC), closedAt.atOffset(ZoneOffset.UTC));
  }

  private static String sql(String name) {
    try {
      return new ClassPathResource("sql/daily-close/" + name)
          .getContentAsString(StandardCharsets.UTF_8);
    } catch (IOException exception) {
      throw new IllegalStateException("Daily close SQL is unavailable", exception);
    }
  }
}

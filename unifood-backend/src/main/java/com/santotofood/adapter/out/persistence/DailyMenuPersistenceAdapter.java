package com.santotofood.adapter.out.persistence;

import com.santotofood.domain.port.out.DailyMenuReadRepository;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/** JDBC reads of the 031 tables, one query per block, as the client catalog does. */
@Component
public class DailyMenuPersistenceAdapter implements DailyMenuReadRepository {
  private static final String PUBLISHED_DAY = sql("published-day.sql");
  private static final String ACTIVE_CATEGORIES = sql("active-categories.sql");
  private static final String OPTIONS = sql("options.sql");
  private static final String AVAILABLE_ADDITIONS = sql("available-additions.sql");
  private final JdbcTemplate jdbc;

  public DailyMenuPersistenceAdapter(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  @Override
  public Optional<PublishedDay> findPublishedDay(UUID cafeteriaId, LocalDate businessDate) {
    return jdbc
        .query(
            PUBLISHED_DAY,
            (row, number) ->
                new PublishedDay(
                    row.getString("title_snapshot"), row.getBigDecimal("plate_price_snapshot")),
            cafeteriaId,
            businessDate)
        .stream()
        .findFirst();
  }

  @Override
  public List<Category> findActiveCategories(UUID cafeteriaId) {
    return jdbc.query(
        ACTIVE_CATEGORIES,
        (row, number) ->
            new Category(
                row.getObject("id", UUID.class),
                row.getString("label"),
                Kind.valueOf(row.getString("kind")),
                row.getBoolean("can_skip")),
        cafeteriaId);
  }

  @Override
  public List<Option> findOptions(UUID cafeteriaId, LocalDate businessDate) {
    return jdbc.query(
        OPTIONS,
        (row, number) ->
            new Option(
                row.getObject("id", UUID.class),
                row.getObject("category_id", UUID.class),
                row.getString("label")),
        cafeteriaId,
        businessDate);
  }

  @Override
  public List<Addition> findAvailableAdditions(UUID cafeteriaId, LocalDate businessDate) {
    return jdbc.query(
        AVAILABLE_ADDITIONS,
        (row, number) ->
            new Addition(
                row.getObject("id", UUID.class),
                row.getString("name"),
                row.getBigDecimal("extra_price")),
        cafeteriaId,
        businessDate);
  }

  private static String sql(String name) {
    try {
      return new ClassPathResource("sql/daily-menu/" + name)
          .getContentAsString(StandardCharsets.UTF_8);
    } catch (IOException exception) {
      throw new IllegalStateException("Daily menu SQL is unavailable", exception);
    }
  }
}

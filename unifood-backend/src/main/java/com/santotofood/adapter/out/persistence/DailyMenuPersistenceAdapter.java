package com.santotofood.adapter.out.persistence;

import com.santotofood.domain.port.out.DailyMenuReadRepository;
import com.santotofood.domain.port.out.DailyMenuWriteRepository;
import java.io.IOException;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * JDBC on the 031 tables, as the client catalog and availability do: one query per block on reads,
 * and writes only under the day header lock taken by {@link #lockDay}.
 */
@Component
public class DailyMenuPersistenceAdapter
    implements DailyMenuReadRepository, DailyMenuWriteRepository {
  private static final String PUBLISHED_DAY = sql("published-day.sql");
  private static final String ACTIVE_CATEGORIES = sql("active-categories.sql");
  private static final String OPTIONS = sql("options.sql");
  private static final String AVAILABLE_ADDITIONS = sql("available-additions.sql");
  private static final String SETTINGS = sql("settings.sql");
  private static final String DAY = sql("day.sql");
  private static final String ENSURE_DAY = sql("ensure-day.sql");
  private static final String LOCK_DAY = sql("lock-day.sql");
  private static final String WORKER_ADDITIONS = sql("worker-additions.sql");
  private static final String LOCK_ADDITION = sql("lock-addition.sql");
  private static final String DELETE_REMOVED_OPTIONS = sql("delete-removed-options.sql");
  private static final String KEEP_OPTION = sql("keep-option.sql");
  private static final String INSERT_OPTION = sql("insert-option.sql");
  private static final String COPY_OPTIONS = sql("copy-options.sql");
  private static final String SET_ADDITION = sql("set-addition.sql");
  private static final String PUBLISH = sql("publish.sql");
  private static final String UNPUBLISH = sql("unpublish.sql");
  private static final String BUMP_VERSION = sql("bump-version.sql");
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

  @Override
  public Optional<Settings> findSettings(UUID cafeteriaId) {
    return jdbc
        .query(
            SETTINGS,
            (row, number) -> new Settings(row.getString("title"), row.getBigDecimal("plate_price")),
            cafeteriaId)
        .stream()
        .findFirst();
  }

  @Override
  public Optional<Day> findDay(UUID cafeteriaId, LocalDate businessDate) {
    return jdbc.query(DAY, (row, number) -> day(row), cafeteriaId, businessDate).stream()
        .findFirst();
  }

  @Override
  public Day lockDay(UUID cafeteriaId, LocalDate businessDate) {
    jdbc.update(ENSURE_DAY, cafeteriaId, businessDate);
    return jdbc.queryForObject(LOCK_DAY, (row, number) -> day(row), cafeteriaId, businessDate);
  }

  @Override
  public List<WorkerAddition> findWorkerAdditions(UUID cafeteriaId, LocalDate businessDate) {
    return jdbc.query(
        WORKER_ADDITIONS,
        (row, number) ->
            new WorkerAddition(
                row.getObject("id", UUID.class),
                row.getString("name"),
                row.getBigDecimal("extra_price"),
                row.getBoolean("available")),
        businessDate,
        cafeteriaId);
  }

  @Override
  public Optional<CatalogAddition> lockAddition(UUID cafeteriaId, UUID additionId) {
    return jdbc
        .query(
            LOCK_ADDITION,
            (row, number) ->
                new CatalogAddition(
                    row.getObject("id", UUID.class),
                    row.getString("name"),
                    row.getBigDecimal("extra_price"),
                    row.getBoolean("active")),
            cafeteriaId,
            additionId)
        .stream()
        .findFirst();
  }

  @Override
  public void replaceOptions(
      UUID cafeteriaId, LocalDate businessDate, UUID categoryId, List<String> labels) {
    jdbc.update(
        connection -> {
          var statement = connection.prepareStatement(DELETE_REMOVED_OPTIONS);
          statement.setObject(1, cafeteriaId);
          statement.setObject(2, businessDate);
          statement.setObject(3, categoryId);
          statement.setArray(4, connection.createArrayOf("text", labels.toArray()));
          return statement;
        });
    // One row at a time, in order: created_at keeps the worker's order. Options compared by
    // label_key keep their id, so an edit never invalidates a choice of an unchanged option.
    for (String label : labels)
      if (jdbc.update(KEEP_OPTION, label, cafeteriaId, businessDate, categoryId, label) == 0)
        jdbc.update(INSERT_OPTION, cafeteriaId, businessDate, categoryId, label);
  }

  @Override
  public void copyOptions(UUID cafeteriaId, LocalDate from, LocalDate to, UUID categoryId) {
    jdbc.update(COPY_OPTIONS, to, cafeteriaId, from, categoryId);
  }

  @Override
  public void setAddition(
      UUID cafeteriaId, LocalDate businessDate, UUID additionId, boolean on, BigDecimal price) {
    jdbc.update(SET_ADDITION, cafeteriaId, businessDate, additionId, on, price);
  }

  @Override
  public void publish(
      UUID cafeteriaId, LocalDate businessDate, String title, BigDecimal price, UUID workerId) {
    jdbc.update(PUBLISH, title, price, workerId, cafeteriaId, businessDate);
  }

  @Override
  public void unpublish(UUID cafeteriaId, LocalDate businessDate) {
    jdbc.update(UNPUBLISH, cafeteriaId, businessDate);
  }

  @Override
  public long bumpVersion(UUID cafeteriaId, LocalDate businessDate) {
    return jdbc.queryForObject(BUMP_VERSION, Long.class, cafeteriaId, businessDate);
  }

  private static Day day(ResultSet row) throws SQLException {
    return new Day(
        row.getLong("version"),
        row.getBoolean("published"),
        row.getString("title_snapshot"),
        row.getBigDecimal("plate_price_snapshot"));
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

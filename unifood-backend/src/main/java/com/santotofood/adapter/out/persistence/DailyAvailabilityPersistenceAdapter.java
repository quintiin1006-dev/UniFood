package com.santotofood.adapter.out.persistence;

import com.santotofood.application.exception.AvailabilityException;
import com.santotofood.application.model.AvailabilityItemStatus;
import com.santotofood.application.model.AvailabilitySnapshot;
import com.santotofood.application.port.out.DailyAvailabilityPort;
import com.santotofood.domain.model.BusinessDate;
import com.santotofood.domain.model.CafeteriaDailyState;
import com.santotofood.domain.model.CatalogCategory;
import com.santotofood.domain.model.DailyItemAvailability;
import com.santotofood.shared.error.ErrorCode;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Optional;
import java.util.UUID;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

@Component
public class DailyAvailabilityPersistenceAdapter implements DailyAvailabilityPort {
  private static final String TODAY = sql("today.sql");
  private static final String LOCK_CAFETERIA = sql("lock-cafeteria.sql");
  private static final String LOCK_ITEM = sql("lock-item.sql");
  private static final String SET_CAFETERIA = sql("set-cafeteria.sql");
  private static final String SET_ITEM = sql("set-item.sql");
  private final JdbcTemplate jdbc;

  public DailyAvailabilityPersistenceAdapter(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  @Override
  public Optional<AvailabilitySnapshot> find(UUID cafeteriaId, BusinessDate date) {
    return jdbc.query(
        TODAY,
        result -> {
          if (!result.next()) return Optional.empty();
          var cafeteria =
              new AvailabilitySnapshot.Cafeteria(
                  result.getObject("cafeteria_id", UUID.class), result.getString("cafeteria_name"),
                  result.getBoolean("cafeteria_active"), result.getBoolean("is_open"));
          var items = new ArrayList<AvailabilitySnapshot.Item>();
          do {
            UUID itemId = result.getObject("item_id", UUID.class);
            if (itemId != null)
              items.add(
                  new AvailabilitySnapshot.Item(
                      itemId,
                      result.getString("name"),
                      result.getString("description"),
                      result.getBigDecimal("price"),
                      result.getString("image_url"),
                      category(result.getString("category")),
                      result.getBoolean("is_available")));
          } while (result.next());
          return Optional.of(new AvailabilitySnapshot(cafeteria, java.util.List.copyOf(items)));
        },
        date.value(),
        date.value(),
        cafeteriaId);
  }

  @Override
  public Optional<Boolean> lockCafeteriaActivity(UUID cafeteriaId) {
    return jdbc
        .query(LOCK_CAFETERIA, (row, index) -> row.getBoolean("is_active"), cafeteriaId)
        .stream()
        .findFirst();
  }

  @Override
  public Optional<AvailabilityItemStatus> lockItem(UUID cafeteriaId, UUID itemId) {
    return jdbc
        .query(
            LOCK_ITEM,
            (row, index) ->
                new AvailabilityItemStatus(
                    row.getBoolean("is_active"), category(row.getString("category"))),
            itemId,
            cafeteriaId)
        .stream()
        .findFirst();
  }

  @Override
  public CafeteriaDailyState setCafeteria(UUID cafeteriaId, BusinessDate date, boolean open) {
    return jdbc.queryForObject(
        SET_CAFETERIA,
        (row, index) ->
            new CafeteriaDailyState(
                row.getObject("cafeteria_id", UUID.class),
                businessDate(row),
                row.getBoolean("is_open"),
                row.getTimestamp("created_at").toInstant(),
                row.getTimestamp("updated_at").toInstant()),
        cafeteriaId,
        date.value(),
        open);
  }

  @Override
  public DailyItemAvailability setItem(
      UUID cafeteriaId, UUID itemId, BusinessDate date, boolean available) {
    return jdbc.queryForObject(
        SET_ITEM,
        (row, index) ->
            new DailyItemAvailability(
                row.getObject("cafeteria_id", UUID.class),
                row.getObject("item_id", UUID.class),
                businessDate(row),
                row.getBoolean("is_available"),
                row.getTimestamp("created_at").toInstant(),
                row.getTimestamp("updated_at").toInstant()),
        cafeteriaId,
        itemId,
        date.value(),
        available);
  }

  private static BusinessDate businessDate(ResultSet row) throws SQLException {
    return new BusinessDate(row.getObject("business_date", LocalDate.class));
  }

  private static CatalogCategory category(String value) {
    if (value == null) return null;
    try {
      return CatalogCategory.valueOf(value);
    } catch (IllegalArgumentException exception) {
      throw new AvailabilityException(ErrorCode.AVAILABILITY_CATALOG_INVALID);
    }
  }

  private static String sql(String name) {
    try {
      return new ClassPathResource("sql/availability/" + name)
          .getContentAsString(StandardCharsets.UTF_8);
    } catch (IOException exception) {
      throw new IllegalStateException("Availability query unavailable", exception);
    }
  }
}

package com.santotofood.adapter.out.persistence;

import com.santotofood.application.model.AdminDashboard;
import com.santotofood.application.model.AdminDashboard.*;
import com.santotofood.application.port.out.AdminDashboardQueryPort;
import java.io.IOException;
import java.math.BigDecimal;
import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Types;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Component;

@Component
public class AdminDashboardPersistenceAdapter implements AdminDashboardQueryPort {
  private static final String EVENTS = sql("events.sql");
  private static final String DAILY = EVENTS + sql("daily.sql");
  private static final String ITEMS = EVENTS + sql("item-quality.sql");
  private static final String DATES = EVENTS + sql("date-quality.sql");
  private static final String RANKING = EVENTS + sql("ranking.sql");
  private final NamedParameterJdbcTemplate jdbc;

  public AdminDashboardPersistenceAdapter(JdbcTemplate jdbc) {
    this.jdbc = new NamedParameterJdbcTemplate(jdbc);
  }

  @Override
  public boolean cafeteriaExists(UUID id) {
    return Boolean.TRUE.equals(
        jdbc.queryForObject(
            "SELECT EXISTS (SELECT 1 FROM public.cafeterias WHERE id=:id)",
            new MapSqlParameterSource("id", id),
            Boolean.class));
  }

  private MapSqlParameterSource parameters(Query q) {
    return new MapSqlParameterSource()
        .addValue("cafeteriaId", q.cafeteriaId(), Types.OTHER)
        .addValue(
            "start",
            q.period().startInclusive().atOffset(ZoneOffset.UTC),
            Types.TIMESTAMP_WITH_TIMEZONE)
        .addValue(
            "end",
            q.period().endExclusive().atOffset(ZoneOffset.UTC),
            Types.TIMESTAMP_WITH_TIMEZONE)
        .addValue("asOf", q.period().asOf().atOffset(ZoneOffset.UTC), Types.TIMESTAMP_WITH_TIMEZONE)
        .addValue("limit", q.limit(), Types.INTEGER);
  }

  @Override
  public List<Daily> daily(Query q) {
    return jdbc.query(
        DAILY,
        parameters(q),
        (r, n) ->
            new Daily(
                r.getObject("day", LocalDate.class),
                Event.valueOf(r.getString("event_type")),
                integer(r, "orders"),
                r.getBigDecimal("value"),
                integer(r, "invalid_amounts")));
  }

  @Override
  public List<ItemQuality> itemQuality(Query q) {
    return jdbc.query(
        ITEMS,
        parameters(q),
        (r, n) ->
            new ItemQuality(
                Event.valueOf(r.getString("event_type")),
                integer(r, "examined"),
                integer(r, "unusable"),
                integer(r, "reconcilable"),
                integer(r, "mismatched"),
                integer(r, "missing_names")));
  }

  @Override
  public List<DateQuality> dateQuality(Query q) {
    return jdbc.query(
        DATES,
        parameters(q),
        (r, n) ->
            new DateQuality(r.getString("basis"), integer(r, "examined"), integer(r, "affected")));
  }

  @Override
  public Ranking ranking(Query q, Event outcome) {
    if (outcome == Event.RECEIVED) throw new IllegalArgumentException("Not a terminal ranking");
    return jdbc.query(
        RANKING,
        parameters(q).addValue("outcome", outcome.name()),
        r -> {
          if (!r.next()) throw new IllegalStateException("Missing dashboard ranking totals");
          Totals totals =
              new Totals(
                  integer(r, "total_products"),
                  integer(r, "total_orders"),
                  integer(r, "total_units"),
                  r.getBigDecimal("total_value"));
          List<Product> products = new ArrayList<>();
          do {
            UUID id = r.getObject("lunch_id", UUID.class);
            if (id != null) {
              BigInteger units = integer(r, "units");
              products.add(
                  new Product(
                      id,
                      r.getString("historical_name"),
                      units,
                      integer(r, "orders"),
                      r.getBigDecimal("item_value"),
                      outcome == Event.NOT_COLLECTED
                          ? AdminDashboard.percentage(units, totals.units())
                          : null));
            }
          } while (r.next());
          BigInteger omittedProducts =
              totals.products().subtract(BigInteger.valueOf(products.size()));
          BigInteger shownUnits =
              products.stream().map(Product::units).reduce(BigInteger.ZERO, BigInteger::add);
          BigDecimal shownValue =
              products.stream().map(Product::itemValue).reduce(BigDecimal.ZERO, BigDecimal::add);
          return new Ranking(
              "AVAILABLE",
              q.limit(),
              omittedProducts.signum() > 0,
              totals,
              new Omitted(
                  omittedProducts,
                  totals.units().subtract(shownUnits),
                  totals.itemValue().subtract(shownValue)),
              products);
        });
  }

  private static BigInteger integer(ResultSet row, String column) throws SQLException {
    return row.getBigDecimal(column).toBigIntegerExact();
  }

  private static String sql(String name) {
    try {
      return new ClassPathResource("sql/admin-dashboard/" + name)
              .getContentAsString(StandardCharsets.UTF_8)
          + "\n";
    } catch (IOException exception) {
      throw new IllegalStateException("Dashboard query unavailable", exception);
    }
  }
}

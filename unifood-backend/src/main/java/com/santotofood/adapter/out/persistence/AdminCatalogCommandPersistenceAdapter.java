package com.santotofood.adapter.out.persistence;

import static com.santotofood.application.exception.AdminCatalogCommandException.Reason.DUPLICATE_NAME;

import com.santotofood.application.exception.AdminCatalogCommandException;
import com.santotofood.application.model.AdminCatalogProduct;
import com.santotofood.application.model.CatalogForm;
import com.santotofood.application.port.out.AdminCatalogCommandPort;
import com.santotofood.domain.model.CatalogCategory;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.LocalDate;
import java.util.Optional;
import java.util.UUID;
import org.springframework.core.io.ClassPathResource;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

@Component
public class AdminCatalogCommandPersistenceAdapter implements AdminCatalogCommandPort {
  private final JdbcTemplate jdbc;

  public AdminCatalogCommandPersistenceAdapter(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  private static String sql(String name) {
    try {
      return new ClassPathResource("sql/admin/" + name + ".sql")
          .getContentAsString(StandardCharsets.UTF_8);
    } catch (IOException e) {
      throw new IllegalStateException("Catalog command unavailable", e);
    }
  }

  private static final String GUARD = sql("lock-catalog-authorization"),
      CAFE = sql("lock-catalog-cafeteria"),
      PRODUCT = sql("lock-catalog-product"),
      CREATE = sql("create-catalog-product"),
      EDIT = sql("edit-catalog-product"),
      STATUS = sql("set-catalog-status"),
      DISABLE = sql("disable-reactivated-product");

  static AdminCatalogProduct product(ResultSet r, int index) throws SQLException {
    return new AdminCatalogProduct(
        r.getObject("id", UUID.class),
        r.getString("name"),
        r.getString("description"),
        r.getBigDecimal("price"),
        CatalogCategory.valueOf(r.getString("category")),
        com.santotofood.application.model.CatalogImage.source(
            r.getObject("id", UUID.class),
            r.getObject("image_asset_id", UUID.class),
            r.getString("image_url")),
        r.getBoolean("is_active"),
        r.getLong("version"));
  }

  @Override
  public void lockAuthorizationGuard() {
    jdbc.queryForObject(GUARD, Boolean.class);
  }

  @Override
  public boolean lockActiveCafeteria(UUID cafe) {
    return jdbc.query(CAFE, (r, i) -> r.getBoolean("is_active"), cafe).stream()
        .findFirst()
        .orElse(false);
  }

  @Override
  public Optional<AdminCatalogProduct> lockProduct(UUID cafe, UUID id) {
    return jdbc.query(PRODUCT, AdminCatalogCommandPersistenceAdapter::product, cafe, id).stream()
        .findFirst();
  }

  @Override
  public AdminCatalogProduct create(UUID cafe, CatalogForm f) {
    try {
      return jdbc.queryForObject(
          CREATE,
          AdminCatalogCommandPersistenceAdapter::product,
          cafe,
          f.name(),
          f.description(),
          f.price(),
          f.category().name());
    } catch (DuplicateKeyException e) {
      throw duplicate(e);
    }
  }

  @Override
  public Optional<AdminCatalogProduct> edit(UUID cafe, UUID id, long version, CatalogForm f) {
    try {
      return jdbc
          .query(
              EDIT,
              AdminCatalogCommandPersistenceAdapter::product,
              f.name(),
              f.description(),
              f.price(),
              f.category().name(),
              cafe,
              id,
              version)
          .stream()
          .findFirst();
    } catch (DuplicateKeyException e) {
      throw duplicate(e);
    }
  }

  @Override
  public Optional<AdminCatalogProduct> status(UUID cafe, UUID id, long version, boolean active) {
    return jdbc
        .query(STATUS, AdminCatalogCommandPersistenceAdapter::product, active, cafe, id, version)
        .stream()
        .findFirst();
  }

  @Override
  public void disableDailyAvailability(UUID cafe, UUID id, LocalDate date) {
    jdbc.update(DISABLE, cafe, id, date);
  }

  private RuntimeException duplicate(DuplicateKeyException e) {
    // Map only the published name constraint, not unrelated integrity failures.
    for (Throwable cause = e; cause != null; cause = cause.getCause())
      if (cause instanceof SQLException s
          && "23505".equals(s.getSQLState())
          && s.getMessage().contains("uq_lunch_name_per_cafeteria"))
        return new AdminCatalogCommandException(DUPLICATE_NAME);
    return e;
  }
}

package com.santotofood.adapter.out.persistence;

import com.santotofood.application.model.AdminCatalogProduct;
import com.santotofood.application.port.out.AdminCatalogQueryPort;
import com.santotofood.domain.model.CatalogCategory;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

@Component
public class AdminCatalogPersistenceAdapter implements AdminCatalogQueryPort {
  private static final String CATALOG = catalogSql();
  private final JdbcTemplate jdbc;

  public AdminCatalogPersistenceAdapter(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  @Override
  public Optional<List<AdminCatalogProduct>> findByCafeteria(UUID authorizedCafeteriaId) {
    Objects.requireNonNull(authorizedCafeteriaId);
    var rows =
        jdbc.query(
            CATALOG,
            (row, index) -> {
              UUID id = row.getObject("id", UUID.class);
              // LEFT JOIN distinguishes an existing empty cafeteria from a broken assignment.
              if (id == null) return null;
              return new AdminCatalogProduct(
                  id,
                  row.getString("name"),
                  row.getString("description"),
                  row.getBigDecimal("price"),
                  CatalogCategory.valueOf(row.getString("category")),
                  row.getString("image_url"),
                  row.getBoolean("is_active"),
                  row.getLong("version"));
            },
            authorizedCafeteriaId);
    if (rows.isEmpty()) return Optional.empty();
    return Optional.of(rows.stream().filter(Objects::nonNull).toList());
  }

  private static String catalogSql() {
    try {
      return new ClassPathResource("sql/admin/catalog.sql")
          .getContentAsString(StandardCharsets.UTF_8);
    } catch (IOException exception) {
      throw new IllegalStateException("Admin catalog query unavailable", exception);
    }
  }
}

package com.santotofood.adapter.out.persistence;

import com.santotofood.application.model.AdminProfileDetails;
import com.santotofood.application.port.out.AdminProfileQueryPort;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

@Component
public class AdminProfilePersistenceAdapter implements AdminProfileQueryPort {
  private static final String PROFILE = profileSql();
  private final JdbcTemplate jdbc;

  public AdminProfilePersistenceAdapter(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  @Override
  public Optional<AdminProfileDetails> findByUserAndCafeteria(
      UUID userId, UUID authorizedCafeteriaId) {
    Objects.requireNonNull(userId);
    Objects.requireNonNull(authorizedCafeteriaId);
    var rows =
        jdbc.query(
            PROFILE,
            (row, index) ->
                new AdminProfileDetails(
                    row.getString("cafeteria_name"),
                    Objects.requireNonNull(row.getObject("cafeteria_active", Boolean.class)),
                    row.getString("site_name"),
                    row.getString("institution_name")),
            userId,
            authorizedCafeteriaId);
    if (rows.size() > 1) throw new IllegalStateException("Inconsistent admin profile cardinality");
    return rows.stream().findFirst();
  }

  private static String profileSql() {
    try {
      return new ClassPathResource("sql/admin/profile.sql")
          .getContentAsString(StandardCharsets.UTF_8);
    } catch (IOException exception) {
      throw new IllegalStateException("Admin profile query unavailable", exception);
    }
  }
}

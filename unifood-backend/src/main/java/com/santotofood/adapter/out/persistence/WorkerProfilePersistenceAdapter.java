package com.santotofood.adapter.out.persistence;

import com.santotofood.application.model.WorkerProfileDetails;
import com.santotofood.application.port.out.WorkerProfileQueryPort;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

@Component
public class WorkerProfilePersistenceAdapter implements WorkerProfileQueryPort {
  private static final String PROFILE = profileSql();
  private final JdbcTemplate jdbc;

  public WorkerProfilePersistenceAdapter(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  @Override
  public Optional<WorkerProfileDetails> findByUserAndCafeteria(
      UUID userId, UUID authorizedCafeteriaId) {
    Objects.requireNonNull(userId);
    Objects.requireNonNull(authorizedCafeteriaId);
    var rows =
        jdbc.query(
            PROFILE,
            (row, index) ->
                new WorkerProfileDetails(
                    row.getString("cafeteria_name"),
                    Objects.requireNonNull(row.getObject("cafeteria_active", Boolean.class)),
                    row.getString("site_name"),
                    row.getString("institution_name")),
            userId,
            authorizedCafeteriaId);
    if (rows.size() > 1) throw new IllegalStateException("Inconsistent worker profile cardinality");
    return rows.stream().findFirst();
  }

  private static String profileSql() {
    try {
      return new ClassPathResource("sql/worker/profile.sql")
          .getContentAsString(StandardCharsets.UTF_8);
    } catch (IOException exception) {
      throw new IllegalStateException("Worker profile query unavailable", exception);
    }
  }
}

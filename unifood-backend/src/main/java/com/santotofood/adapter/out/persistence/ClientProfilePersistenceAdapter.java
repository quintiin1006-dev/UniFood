package com.santotofood.adapter.out.persistence;

import com.santotofood.application.model.ClientProfileDetails;
import com.santotofood.application.port.out.ClientProfileQueryPort;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Optional;
import java.util.UUID;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

@Component
public class ClientProfilePersistenceAdapter implements ClientProfileQueryPort {
  private static final String PROFILE_SQL = profileSql();
  private final JdbcTemplate jdbc;

  public ClientProfilePersistenceAdapter(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  @Override
  public Optional<ClientProfileDetails> findByUserId(UUID authenticatedUserId) {
    return jdbc
        .query(
            PROFILE_SQL,
            (row, rowNumber) ->
                new ClientProfileDetails(
                    row.getString("document"),
                    row.getString("phone"),
                    row.getString("institution")),
            authenticatedUserId)
        .stream()
        .findFirst();
  }

  private static String profileSql() {
    try {
      return new ClassPathResource("sql/client/profile.sql")
          .getContentAsString(StandardCharsets.UTF_8);
    } catch (IOException exception) {
      throw new IllegalStateException("Client profile query resource unavailable", exception);
    }
  }
}

package com.santotofood.adapter.out.persistence;

import com.santotofood.application.model.OrderOwner;
import com.santotofood.application.model.UserAuthorization;
import com.santotofood.application.port.out.AuthorizationQueryPort;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.Arrays;
import java.util.Optional;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

@Component
public class AuthorizationPersistenceAdapter implements AuthorizationQueryPort {
  private static final String USER_SQL = sql("user-authorization.sql");
  private static final String ORDER_SQL = sql("order-cafeteria.sql");
  private static final String OWNER_SQL = sql("order-owner.sql");
  private final JdbcTemplate jdbc;

  public AuthorizationPersistenceAdapter(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  @Override
  public Optional<UserAuthorization> findUserAuthorization(UUID userId) {
    return jdbc.query(USER_SQL, AuthorizationPersistenceAdapter::userAuthorization, userId).stream()
        .findFirst();
  }

  @Override
  public Optional<UUID> findOrderCafeteria(UUID orderId) {
    var cafeterias = jdbc.queryForList(ORDER_SQL, UUID.class, orderId);
    return cafeterias.size() == 1 ? Optional.of(cafeterias.getFirst()) : Optional.empty();
  }

  @Override
  public Optional<OrderOwner> findOrderOwner(UUID orderId) {
    return jdbc
        .query(
            OWNER_SQL,
            (row, rowNumber) -> new OrderOwner(row.getObject("user_id", UUID.class)),
            orderId)
        .stream()
        .findFirst();
  }

  private static UserAuthorization userAuthorization(ResultSet row, int rowNumber)
      throws SQLException {
    var roles =
        Arrays.stream((Object[]) row.getArray("roles").getArray())
            .map(Object::toString)
            .collect(Collectors.toSet());
    var cafeterias =
        Arrays.stream((Object[]) row.getArray("cafeteria_ids").getArray())
            .map(value -> UUID.fromString(value.toString()))
            .toList();
    return new UserAuthorization(row.getBoolean("is_active"), roles, cafeterias);
  }

  private static String sql(String file) {
    try {
      return new ClassPathResource("sql/authorization/" + file)
          .getContentAsString(StandardCharsets.UTF_8);
    } catch (IOException exception) {
      throw new IllegalStateException("Authorization query resource unavailable", exception);
    }
  }
}

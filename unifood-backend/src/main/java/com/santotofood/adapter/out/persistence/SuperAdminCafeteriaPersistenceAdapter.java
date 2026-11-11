package com.santotofood.adapter.out.persistence;

import com.santotofood.application.model.SuperAdminCafeteriaRow;
import com.santotofood.application.port.out.SuperAdminCafeteriaQueryPort;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

@Component
public class SuperAdminCafeteriaPersistenceAdapter implements SuperAdminCafeteriaQueryPort {
  private static final String TREE = sql();
  private final JdbcTemplate jdbc;

  public SuperAdminCafeteriaPersistenceAdapter(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  @Override
  public List<SuperAdminCafeteriaRow> findCafeteriaTree() {
    return jdbc.query(
        TREE,
        (row, index) ->
            new SuperAdminCafeteriaRow(
                row.getObject("institution_id", UUID.class),
                row.getString("institution_name"),
                Objects.requireNonNull(row.getObject("institution_active", Boolean.class)),
                row.getObject("site_id", UUID.class),
                row.getString("site_name"),
                row.getString("site_city"),
                row.getObject("site_active", Boolean.class),
                row.getObject("cafeteria_id", UUID.class),
                row.getString("cafeteria_name"),
                row.getObject("cafeteria_subscribed", Boolean.class),
                Objects.requireNonNull(
                    row.getObject("cafeteria_has_active_admin", Boolean.class))));
  }

  private static String sql() {
    try {
      return new ClassPathResource("sql/super-admin/cafeterias.sql")
          .getContentAsString(StandardCharsets.UTF_8);
    } catch (IOException exception) {
      throw new IllegalStateException("Super admin cafeteria query unavailable", exception);
    }
  }
}

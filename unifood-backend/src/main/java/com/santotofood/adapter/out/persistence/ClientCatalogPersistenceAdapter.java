package com.santotofood.adapter.out.persistence;

import com.santotofood.application.model.ClientCatalogFacts;
import com.santotofood.application.port.out.ClientCatalogQueryPort;
import com.santotofood.domain.model.CatalogCategory;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

@Component
public class ClientCatalogPersistenceAdapter implements ClientCatalogQueryPort {
  private static final String CLIENT = sql("catalog-client.sql");
  private static final String CAFETERIAS = sql("context-cafeterias.sql");
  private static final String ACTIVE_ORDER = sql("active-order.sql");
  private static final String MENU_CAFETERIA = sql("menu-cafeteria.sql");
  private static final String MENU_ITEMS = sql("menu-items.sql");
  private final JdbcTemplate jdbc;

  public ClientCatalogPersistenceAdapter(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  @Override
  public Optional<ClientCatalogFacts> findClient(UUID authenticatedUserId) {
    return jdbc
        .query(
            CLIENT,
            (row, number) ->
                new ClientCatalogFacts(
                    row.getObject("client_id", UUID.class),
                    row.getString("full_name"),
                    row.getString("client_type"),
                    row.getObject("institution_id", UUID.class),
                    row.getString("institution_name")),
            authenticatedUserId)
        .stream()
        .findFirst();
  }

  @Override
  public List<CafeteriaRow> findActiveCafeterias(UUID institutionId, LocalDate businessDate) {
    return jdbc.query(
        CAFETERIAS,
        (row, number) ->
            new CafeteriaRow(
                row.getObject("site_id", UUID.class),
                row.getString("site_name"),
                row.getObject("cafeteria_id", UUID.class),
                row.getString("cafeteria_name"),
                row.getBoolean("is_open")),
        businessDate,
        institutionId);
  }

  @Override
  public Optional<UUID> findActiveOrder(UUID clientId) {
    return jdbc
        .query(ACTIVE_ORDER, (row, number) -> row.getObject("id", UUID.class), clientId)
        .stream()
        .findFirst();
  }

  @Override
  public Optional<MenuCafeteria> findCafeteria(
      UUID institutionId, UUID cafeteriaId, LocalDate businessDate) {
    return jdbc
        .query(
            MENU_CAFETERIA,
            (row, number) ->
                new MenuCafeteria(
                    row.getObject("id", UUID.class),
                    row.getString("name"),
                    row.getBoolean("is_active"),
                    row.getBoolean("is_open")),
            businessDate,
            cafeteriaId,
            institutionId)
        .stream()
        .findFirst();
  }

  @Override
  public List<MenuItem> findMenuItems(UUID cafeteriaId, LocalDate businessDate) {
    return jdbc.query(
        MENU_ITEMS,
        (row, number) ->
            new MenuItem(
                row.getObject("id", UUID.class),
                row.getString("name"),
                row.getString("description"),
                row.getBigDecimal("price"),
                category(row.getString("category")),
                row.getBoolean("is_available")),
        businessDate,
        cafeteriaId);
  }

  /** A category this build does not know is left out of the menu instead of failing it. */
  private static CatalogCategory category(String value) {
    try {
      return value == null ? null : CatalogCategory.valueOf(value);
    } catch (IllegalArgumentException unknown) {
      return null;
    }
  }

  private static String sql(String name) {
    try {
      return new ClassPathResource("sql/client/" + name).getContentAsString(StandardCharsets.UTF_8);
    } catch (IOException exception) {
      throw new IllegalStateException("Client catalog SQL is unavailable", exception);
    }
  }
}

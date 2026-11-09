package com.santotofood.adapter.out.persistence;

import com.santotofood.application.model.ClientOrder;
import com.santotofood.application.port.out.ClientOrderCommandPort;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.sql.Array;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.PreparedStatementCreator;
import org.springframework.stereotype.Component;

@Component
public class ClientOrderPersistenceAdapter implements ClientOrderCommandPort {
  private static final String CLIENT = sql("ordering-client.sql");
  private static final String BY_KEY = sql("by-idempotency-key.sql");
  private static final String ACTIVE_ORDER = sql("active-order.sql");
  private static final String ORDER = sql("order.sql");
  private static final String ORDER_ITEMS = sql("order-items.sql");
  private static final String LOCK_CAFETERIA = sql("lock-cafeteria.sql");
  private static final String LOCK_DAILY_STATE = sql("lock-daily-state.sql");
  private static final String LOCK_PRODUCTS = sql("lock-products.sql");
  private static final String LOCK_AVAILABILITY = sql("lock-availability.sql");
  private static final String INSERT_ORDER = sql("insert-order.sql");
  private static final String INSERT_ITEM = sql("insert-item.sql");
  private final JdbcTemplate jdbc;

  public ClientOrderPersistenceAdapter(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  @Override
  public Optional<OrderingClient> findOrderingClient(UUID userId) {
    return jdbc
        .query(
            CLIENT,
            (row, number) ->
                new OrderingClient(
                    row.getObject("client_id", UUID.class),
                    row.getString("full_name"),
                    row.getObject("institution_id", UUID.class),
                    row.getString("client_type"),
                    row.getString("institutional_code")),
            userId)
        .stream()
        .findFirst();
  }

  @Override
  public Optional<KeyedOrder> findByIdempotencyKey(UUID clientId, String idempotencyKey) {
    return jdbc
        .query(
            BY_KEY,
            (row, number) ->
                new KeyedOrder(row.getObject("id", UUID.class), row.getString("request_hash")),
            clientId,
            idempotencyKey)
        .stream()
        .findFirst();
  }

  @Override
  public Optional<UUID> findActiveOrder(UUID clientId) {
    return jdbc
        .query(ACTIVE_ORDER, (row, number) -> row.getObject("id", UUID.class), clientId)
        .stream()
        .findFirst();
  }

  @Override
  public Optional<ClientOrder> findOrder(UUID orderId) {
    var items =
        jdbc.query(
            ORDER_ITEMS,
            (row, number) ->
                new ClientOrder.Item(
                    row.getString("lunch_name"),
                    row.getInt("quantity"),
                    row.getBigDecimal("unit_price"),
                    row.getBigDecimal("subtotal")),
            orderId);
    return jdbc
        .query(
            ORDER,
            (row, number) ->
                new ClientOrder(
                    row.getObject("id", UUID.class),
                    row.getString("status"),
                    row.getBigDecimal("total"),
                    row.getString("note"),
                    row.getObject("created_at", OffsetDateTime.class).toInstant(),
                    items),
            orderId)
        .stream()
        .findFirst();
  }

  @Override
  public Optional<LockedCafeteria> lockCafeteria(UUID institutionId, UUID cafeteriaId) {
    return jdbc
        .query(
            LOCK_CAFETERIA,
            (row, number) ->
                new LockedCafeteria(row.getObject("id", UUID.class), row.getBoolean("is_active")),
            cafeteriaId,
            institutionId)
        .stream()
        .findFirst();
  }

  @Override
  public boolean lockOpenToday(UUID cafeteriaId, LocalDate businessDate) {
    return jdbc
        .query(
            LOCK_DAILY_STATE, (row, number) -> row.getBoolean("is_open"), cafeteriaId, businessDate)
        .stream()
        .findFirst()
        .orElse(false);
  }

  @Override
  public List<LockedProduct> lockProducts(UUID cafeteriaId, List<UUID> productIds) {
    return jdbc.query(
        withIds(LOCK_PRODUCTS, productIds, cafeteriaId),
        (row, number) ->
            new LockedProduct(
                row.getObject("id", UUID.class),
                row.getString("name"),
                row.getBigDecimal("price"),
                row.getBoolean("is_active")));
  }

  @Override
  public Set<UUID> lockAvailableToday(
      UUID cafeteriaId, List<UUID> productIds, LocalDate businessDate) {
    var available = new HashSet<UUID>();
    // Every row is locked, available or not, so the worker cannot flip it mid-order.
    jdbc.query(
        withIds(LOCK_AVAILABILITY, productIds, cafeteriaId, businessDate),
        row -> {
          if (row.getBoolean("is_available")) available.add(row.getObject("item_id", UUID.class));
        });
    return Set.copyOf(available);
  }

  @Override
  public void insertOrder(NewOrder order) {
    jdbc.update(
        INSERT_ORDER,
        order.id(),
        order.cafeteriaId(),
        order.client().clientId(),
        order.client().fullName(),
        order.total(),
        order.note(),
        order.idempotencyKey(),
        order.requestHash(),
        order.client().institutionalCode(),
        order.client().clientType());
  }

  @Override
  public void insertItems(UUID orderId, UUID cafeteriaId, List<NewItem> items) {
    for (var item : items)
      jdbc.update(
          INSERT_ITEM,
          orderId,
          cafeteriaId,
          item.productId(),
          item.name(),
          item.unitPrice(),
          item.quantity(),
          item.subtotal());
  }

  /** Binds {@code leading} in order, then the ids as a uuid[] in the last placeholder. */
  private static PreparedStatementCreator withIds(String sql, List<UUID> ids, Object... leading) {
    return (Connection connection) -> {
      PreparedStatement statement = connection.prepareStatement(sql);
      try {
        for (int i = 0; i < leading.length; i++) statement.setObject(i + 1, leading[i]);
        Array array = connection.createArrayOf("uuid", ids.toArray());
        statement.setArray(leading.length + 1, array);
        return statement;
      } catch (SQLException exception) {
        statement.close();
        throw exception;
      }
    };
  }

  private static String sql(String name) {
    try {
      return new ClassPathResource("sql/client-orders/" + name)
          .getContentAsString(StandardCharsets.UTF_8);
    } catch (IOException exception) {
      throw new IllegalStateException("Client order SQL is unavailable", exception);
    }
  }
}

package com.santotofood.adapter.out.persistence;

import com.santotofood.application.model.ClientOrder;
import com.santotofood.application.model.OrderDailyMenu;
import com.santotofood.application.port.out.ClientOrderCommandPort;
import com.santotofood.application.port.out.ClientOrderQueryPort;
import com.santotofood.application.port.out.OrderDailyMenuQueryPort;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.sql.Array;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.PreparedStatementCreator;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Component;

@Component
public class ClientOrderPersistenceAdapter
    implements ClientOrderCommandPort, ClientOrderQueryPort, OrderDailyMenuQueryPort {
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
  private static final String CURRENT_TAG = sql("current-tag.sql");
  private static final String OWN_ORDER = sql("own-order.sql");
  private static final String OWN_ORDER_ITEMS = sql("own-order-items.sql");
  private static final String READING_CLIENT = sql("reading-client.sql");
  private static final String HISTORY_FIRST = sql("history-first.sql");
  private static final String HISTORY_AFTER = sql("history-after.sql");
  private static final String LOCK_DAILY_MENU_DAY = sql("lock-daily-menu-day.sql");
  private static final String INSERT_DAILY_MENU = sql("insert-daily-menu.sql");
  private static final String INSERT_DAILY_MENU_CHOICE = sql("insert-daily-menu-choice.sql");
  private static final String DAILY_MENUS = sql("daily-menus.sql");
  private static final String DAILY_MENU_CHOICES = sql("daily-menu-choices.sql");
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
    var items = jdbc.query(ORDER_ITEMS, ClientOrderPersistenceAdapter::item, orderId);
    return jdbc.query(ORDER, (row, number) -> order(row, items), orderId).stream()
        .findFirst()
        .map(this::withDailyMenu);
  }

  @Override
  public Optional<CurrentTag> findCurrentTag(UUID userId) {
    return jdbc
        .query(
            CURRENT_TAG,
            (row, number) ->
                new CurrentTag(
                    row.getObject("id", UUID.class),
                    row.getString("status"),
                    instant(row, "updated_at"),
                    row.getLong("version")),
            userId)
        .stream()
        .findFirst();
  }

  @Override
  public Optional<ClientOrder> findOwnOrder(UUID userId, UUID orderId) {
    var order =
        jdbc.query(OWN_ORDER, (row, number) -> order(row, List.of()), orderId, userId).stream()
            .findFirst();
    if (order.isEmpty()) return order;
    var items = jdbc.query(OWN_ORDER_ITEMS, ClientOrderPersistenceAdapter::item, orderId, userId);
    var found = order.get();
    return Optional.of(
        withDailyMenu(
            new ClientOrder(
                found.id(),
                found.status(),
                found.total(),
                found.note(),
                found.createdAt(),
                items,
                found.cafeteria(),
                found.cancellationSource(),
                found.rejectionReason(),
                found.timeline(),
                found.requestedPickupAt())));
  }

  @Override
  public Optional<UUID> findClient(UUID userId) {
    return jdbc
        .query(READING_CLIENT, (row, number) -> row.getObject("id", UUID.class), userId)
        .stream()
        .findFirst();
  }

  @Override
  public List<HistoryRow> findHistory(UUID clientId, Position after, int limit) {
    RowMapper<HistoryRow> mapper =
        (row, number) ->
            new HistoryRow(
                row.getObject("id", UUID.class),
                row.getString("status"),
                row.getBigDecimal("total"),
                instant(row, "created_at"),
                row.getString("cafeteria_name"),
                row.getInt("units"),
                row.getInt("products"),
                array(row, "first_names", String.class),
                array(row, "first_quantities", Integer.class));
    if (after == null) return jdbc.query(HISTORY_FIRST, mapper, clientId, limit);
    return jdbc.query(
        HISTORY_AFTER,
        mapper,
        clientId,
        after.createdAt().atOffset(ZoneOffset.UTC),
        after.id(),
        limit);
  }

  private static ClientOrder order(ResultSet row, List<ClientOrder.Item> items)
      throws SQLException {
    return new ClientOrder(
        row.getObject("id", UUID.class),
        row.getString("status"),
        row.getBigDecimal("total"),
        row.getString("note"),
        instant(row, "created_at"),
        items,
        new ClientOrder.Cafeteria(
            row.getObject("cafeteria_id", UUID.class), row.getString("cafeteria_name")),
        row.getString("cancellation_source"),
        row.getString("rejection_reason"),
        new ClientOrder.Timeline(
            instant(row, "updated_at"),
            instant(row, "called_at"),
            row.getInt("reminder_count"),
            instant(row, "last_reminded_at"),
            instant(row, "delivered_at"),
            instant(row, "not_collected_at"),
            instant(row, "cancelled_at")),
        instant(row, "requested_pickup_at"));
  }

  private static ClientOrder.Item item(ResultSet row, int number) throws SQLException {
    return new ClientOrder.Item(
        row.getString("lunch_name"),
        row.getInt("quantity"),
        row.getBigDecimal("unit_price"),
        row.getBigDecimal("subtotal"));
  }

  private static Instant instant(ResultSet row, String column) throws SQLException {
    var value = row.getObject(column, OffsetDateTime.class);
    return value == null ? null : value.toInstant();
  }

  /** An order without items aggregates to NULL arrays. */
  private static <T> List<T> array(ResultSet row, String column, Class<T> type)
      throws SQLException {
    Array array = row.getArray(column);
    if (array == null) return List.of();
    try {
      return Arrays.stream((Object[]) array.getArray()).map(type::cast).toList();
    } finally {
      array.free();
    }
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
        order.requestedPickupAt() == null
            ? null
            : order.requestedPickupAt().atOffset(ZoneOffset.UTC),
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

  @Override
  public Optional<PublishedDailyMenu> lockPublishedDailyMenu(
      UUID cafeteriaId, LocalDate businessDate) {
    return jdbc
        .query(
            LOCK_DAILY_MENU_DAY,
            (row, number) ->
                row.getBoolean("published")
                    ? new PublishedDailyMenu(
                        row.getString("title_snapshot"), row.getBigDecimal("plate_price_snapshot"))
                    : null,
            cafeteriaId,
            businessDate)
        .stream()
        .filter(java.util.Objects::nonNull)
        .findFirst();
  }

  @Override
  public void insertDailyMenu(
      UUID orderId,
      UUID cafeteriaId,
      LocalDate businessDate,
      PublishedDailyMenu plate,
      List<NewChoice> choices) {
    jdbc.update(
        INSERT_DAILY_MENU, orderId, cafeteriaId, businessDate, plate.title(), plate.price());
    // One row at a time, in order: created_at keeps the template order.
    for (var choice : choices)
      jdbc.update(
          INSERT_DAILY_MENU_CHOICE,
          orderId,
          cafeteriaId,
          choice.kind(),
          choice.categoryId(),
          choice.categoryLabel(),
          choice.label(),
          choice.extraPrice(),
          choice.sourceOptionId(),
          choice.sourceAdditionId());
  }

  /** Two reads for any number of orders: the headers, then every choice in written order. */
  @Override
  public Map<UUID, OrderDailyMenu> findDailyMenus(Collection<UUID> orderIds) {
    if (orderIds.isEmpty()) return Map.of();
    var ids = List.copyOf(orderIds);
    var headers = new HashMap<UUID, OrderDailyMenu>();
    jdbc.query(
        withIds(DAILY_MENUS, ids),
        (ResultSet row) -> {
          headers.put(
              row.getObject("order_id", UUID.class),
              new OrderDailyMenu(
                  row.getString("title_snapshot"), row.getBigDecimal("plate_price"), List.of()));
        });
    if (headers.isEmpty()) return Map.of();
    var choices = new HashMap<UUID, List<OrderDailyMenu.Choice>>();
    jdbc.query(
        withIds(DAILY_MENU_CHOICES, ids),
        (ResultSet row) -> {
          choices
              .computeIfAbsent(row.getObject("order_id", UUID.class), id -> new ArrayList<>())
              .add(
                  new OrderDailyMenu.Choice(
                      row.getString("category_label"),
                      row.getString("line_kind"),
                      row.getString("option_label"),
                      row.getBigDecimal("extra_price")));
        });
    var menus = new HashMap<UUID, OrderDailyMenu>();
    headers.forEach(
        (id, header) ->
            menus.put(
                id,
                new OrderDailyMenu(
                    header.title(), header.price(), choices.getOrDefault(id, List.of()))));
    return Map.copyOf(menus);
  }

  private ClientOrder withDailyMenu(ClientOrder order) {
    return order.withDailyMenu(findDailyMenus(List.of(order.id())).get(order.id()));
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

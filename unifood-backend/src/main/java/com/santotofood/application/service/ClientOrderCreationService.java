package com.santotofood.application.service;

import com.santotofood.application.exception.ClientOrderException;
import com.santotofood.application.model.ClientOrder;
import com.santotofood.application.port.in.CreateOwnOrderUseCase;
import com.santotofood.application.port.out.ClientOrderCommandPort;
import com.santotofood.application.port.out.ClientOrderCommandPort.KeyedOrder;
import com.santotofood.application.port.out.ClientOrderCommandPort.LockedProduct;
import com.santotofood.application.port.out.ClientOrderCommandPort.NewItem;
import com.santotofood.application.port.out.ClientOrderCommandPort.NewOrder;
import com.santotofood.domain.model.BusinessDate;
import com.santotofood.domain.model.PickupTime;
import com.santotofood.domain.port.out.TimeProvider;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Function;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.dao.TransientDataAccessException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.TransactionException;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * B15 (docs/decisiones.md §6 and §11). The server owns prices, totals, availability and the single
 * active order; the request only names products and quantities.
 *
 * <p>The whole creation is one READ COMMITTED transaction. The database has the last word on races:
 * {@code uq_orders_client_idempotency_key} and {@code uq_orders_one_active_per_client} (020). The
 * loser of a race rolls back, and a fresh read, which now sees the winner's commit, turns its
 * unique violation into a retry (200) or a 409.
 */
@Service
public class ClientOrderCreationService implements CreateOwnOrderUseCase {
  public static final int MAX_UNITS_PER_PRODUCT = 10;
  public static final int MAX_UNITS_PER_ORDER = 15;
  public static final int MAX_NOTE_LENGTH = 200;

  /** chk_orders_idempotency_key_format (020). */
  private static final Pattern IDEMPOTENCY_KEY = Pattern.compile("[A-Za-z0-9_-]{16,128}");

  private final ClientOrderCommandPort orders;
  private final TimeProvider clock;
  private final TransactionTemplate write;
  private final TransactionTemplate read;

  public ClientOrderCreationService(
      ClientOrderCommandPort orders, TimeProvider clock, PlatformTransactionManager manager) {
    this.orders = orders;
    this.clock = clock;
    this.write = transaction(manager, false);
    this.read = transaction(manager, true);
  }

  @Override
  public CreatedOrder createOwnOrder(UUID userId, String idempotencyKey, OrderRequest request) {
    try {
      try {
        return write.execute(status -> create(userId, idempotencyKey, request));
      } catch (DuplicateKeyException race) {
        return read.execute(status -> afterRace(userId, idempotencyKey, request))
            .orElseThrow(ClientOrderException::temporarilyUnavailable);
      }
    } catch (TransientDataAccessException
        | DataAccessResourceFailureException
        | TransactionException unavailable) {
      throw ClientOrderException.temporarilyUnavailable();
    }
  }

  private CreatedOrder create(UUID userId, String idempotencyKey, OrderRequest request) {
    // An inactive account or a missing client row is refused before anything is validated.
    var client = orders.findOrderingClient(userId).orElseThrow(ClientOrderException::forbidden);
    var order = Normalized.of(idempotencyKey, request);

    // A key serves one request for good: replaying it after delivery is still a retry.
    var keyed = orders.findByIdempotencyKey(client.clientId(), idempotencyKey);
    if (keyed.isPresent()) return replay(keyed.get(), order.hash());
    // After the replay: retrying a served request answers 200 even once its time has passed.
    var now = clock.now();
    if (order.pickup() != null && !order.pickup().isValidAt(now))
      throw ClientOrderException.invalidPickupTime();
    orders
        .findActiveOrder(client.clientId())
        .ifPresent(
            active -> {
              throw ClientOrderException.activeOrderExists(active);
            });

    var date = BusinessDate.from(now).value();
    // Lock order of §11: cafeteria (the subscription lives there), products by id, today's rows.
    var cafeteria =
        orders
            .lockCafeteria(client.institutionId(), order.cafeteriaId())
            .orElseThrow(ClientOrderException::cafeteriaNotFound);
    if (!cafeteria.active()) throw ClientOrderException.cafeteriaNotSubscribed();
    var ids = order.items().stream().map(Line::productId).toList();
    var products =
        orders.lockProducts(cafeteria.id(), ids).stream()
            .collect(Collectors.toMap(LockedProduct::id, Function.identity()));
    if (!orders.lockOpenToday(cafeteria.id(), date)) throw ClientOrderException.cafeteriaClosed();
    var available = orders.lockAvailableToday(cafeteria.id(), ids, date);

    var items = new ArrayList<NewItem>();
    var total = BigDecimal.ZERO;
    for (var line : order.items()) {
      var product = products.get(line.productId());
      // Missing, foreign, inactive and not available today look the same to the client.
      if (product == null || !product.active() || !available.contains(line.productId()))
        throw ClientOrderException.productUnavailable();
      var item = new NewItem(product.id(), product.name(), product.price(), line.quantity());
      items.add(item);
      total = total.add(item.subtotal());
    }

    var id = UUID.randomUUID();
    orders.insertOrder(
        new NewOrder(
            id,
            cafeteria.id(),
            client,
            total,
            order.note(),
            order.pickup() == null ? null : order.pickup().value(),
            idempotencyKey,
            order.hash()));
    orders.insertItems(id, cafeteria.id(), items);
    return new CreatedOrder(stored(id), true);
  }

  /** The winner has committed: the same request is a retry, anything else a 409. */
  private Optional<CreatedOrder> afterRace(
      UUID userId, String idempotencyKey, OrderRequest request) {
    var client = orders.findOrderingClient(userId).orElseThrow(ClientOrderException::forbidden);
    var hash = Normalized.of(idempotencyKey, request).hash();
    var keyed = orders.findByIdempotencyKey(client.clientId(), idempotencyKey);
    if (keyed.isPresent()) return Optional.of(replay(keyed.get(), hash));
    var active = orders.findActiveOrder(client.clientId());
    if (active.isPresent()) throw ClientOrderException.activeOrderExists(active.get());
    return Optional.empty();
  }

  private CreatedOrder replay(KeyedOrder keyed, String hash) {
    if (!keyed.requestHash().equals(hash)) throw ClientOrderException.idempotencyKeyConflict();
    // Its current state and items, in the same shape as the 201.
    return new CreatedOrder(stored(keyed.orderId()), false);
  }

  private ClientOrder stored(UUID orderId) {
    return orders
        .findOrder(orderId)
        .orElseThrow(() -> new IllegalStateException("Created order is not readable"));
  }

  private static TransactionTemplate transaction(
      PlatformTransactionManager manager, boolean readOnly) {
    var template = new TransactionTemplate(manager);
    template.setIsolationLevel(TransactionDefinition.ISOLATION_READ_COMMITTED);
    template.setTimeout(15);
    template.setReadOnly(readOnly);
    return template;
  }

  /**
   * The request as the server understands it. Items are sorted by product id and the note is
   * trimmed, with blank meaning none, so reordering items or padding the note keeps the hash. The
   * pickup time is the instant it names, whatever offset it was written in.
   */
  record Normalized(
      UUID cafeteriaId, List<Line> items, String note, PickupTime pickup, String hash) {

    static Normalized of(String idempotencyKey, OrderRequest request) {
      if (idempotencyKey == null
          || !IDEMPOTENCY_KEY.matcher(idempotencyKey).matches()
          || request == null
          || request.cafeteriaId() == null
          || request.items() == null
          || request.items().isEmpty()
          // contains(null) throws on immutable lists.
          || request.items().stream().anyMatch(java.util.Objects::isNull))
        throw ClientOrderException.invalidRequest();

      var items = new ArrayList<>(request.items());
      items.sort(Comparator.comparing(line -> String.valueOf(line.productId())));
      int units = 0;
      for (int i = 0; i < items.size(); i++) {
        var line = items.get(i);
        if (line.productId() == null || line.quantity() < 1)
          throw ClientOrderException.invalidRequest();
        // Repeated products are refused, never added up.
        if (i > 0 && items.get(i - 1).productId().equals(line.productId()))
          throw ClientOrderException.invalidRequest();
        if (line.quantity() > MAX_UNITS_PER_PRODUCT) throw ClientOrderException.limitExceeded();
        units += line.quantity();
        if (units > MAX_UNITS_PER_ORDER) throw ClientOrderException.limitExceeded();
      }

      var note = request.note() == null ? null : request.note().strip();
      if (note != null && note.isEmpty()) note = null;
      // chk_orders_note counts characters, as length() does in PostgreSQL.
      if (note != null && note.codePointCount(0, note.length()) > MAX_NOTE_LENGTH)
        throw ClientOrderException.noteTooLong();

      // Only its format here: whether it is still ahead today is checked after a replay.
      PickupTime pickup = null;
      if (request.requestedPickupAt() != null)
        pickup =
            PickupTime.parse(request.requestedPickupAt())
                .orElseThrow(ClientOrderException::invalidPickupTime);

      return new Normalized(
          request.cafeteriaId(),
          List.copyOf(items),
          note,
          pickup,
          hash(request.cafeteriaId(), items, pickup, note));
    }

    /**
     * SHA-256 hex of a canonical form; the note goes last, so it needs no escaping. A pickup time
     * adds one {@code @instant} line before it, which no item line can look like; without one the
     * form is exactly B15's, so the keys already stored keep their hash.
     */
    private static String hash(UUID cafeteriaId, List<Line> items, PickupTime pickup, String note) {
      var canonical = new StringBuilder("order-v1\n").append(cafeteriaId).append('\n');
      for (var line : items)
        canonical.append(line.productId()).append(':').append(line.quantity()).append('\n');
      if (pickup != null) canonical.append('@').append(pickup.value()).append('\n');
      canonical.append(note == null ? "-" : "+" + note);
      try {
        return HexFormat.of()
            .formatHex(
                MessageDigest.getInstance("SHA-256")
                    .digest(canonical.toString().getBytes(StandardCharsets.UTF_8)));
      } catch (NoSuchAlgorithmException impossible) {
        throw new IllegalStateException(impossible);
      }
    }
  }
}

package com.santotofood.application.service;

import com.santotofood.application.exception.ClientOrderException;
import com.santotofood.application.model.ClientOrder;
import com.santotofood.application.port.in.CreateOwnOrderUseCase;
import com.santotofood.application.port.out.ClientOrderCommandPort;
import com.santotofood.application.port.out.ClientOrderCommandPort.KeyedOrder;
import com.santotofood.application.port.out.ClientOrderCommandPort.LockedProduct;
import com.santotofood.application.port.out.ClientOrderCommandPort.NewChoice;
import com.santotofood.application.port.out.ClientOrderCommandPort.NewItem;
import com.santotofood.application.port.out.ClientOrderCommandPort.NewOrder;
import com.santotofood.application.port.out.DailyMenuFlag;
import com.santotofood.domain.model.BusinessDate;
import com.santotofood.domain.model.OrderPushEvent;
import com.santotofood.domain.model.PickupTime;
import com.santotofood.domain.port.out.DailyMenuReadRepository;
import com.santotofood.domain.port.out.DailyMenuReadRepository.Kind;
import com.santotofood.domain.port.out.PushNotificationPort;
import com.santotofood.domain.port.out.TimeProvider;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Function;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import org.springframework.beans.factory.annotation.Autowired;
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
 *
 * <p>An order may carry one daily menu plate (docs/propuesta-menu-dinamico.md, sections 3.2 to
 * 3.4): it counts as one unit, its additions do not, and its price and the additions' prices are
 * the frozen copies of the day. Behind MENU_DINAMICO_ENABLED; without a menu nothing changes.
 */
@Service
public class ClientOrderCreationService implements CreateOwnOrderUseCase {
  public static final int MAX_UNITS_PER_PRODUCT = 10;
  public static final int MAX_UNITS_PER_ORDER = 15;
  public static final int MAX_NOTE_LENGTH = 200;

  /** More than a template can have: anything above is not a real request. */
  static final int MAX_MENU_LINES = 20;

  /** chk_orders_idempotency_key_format (020). */
  private static final Pattern IDEMPOTENCY_KEY = Pattern.compile("[A-Za-z0-9_-]{16,128}");

  private static final org.slf4j.Logger LOG =
      org.slf4j.LoggerFactory.getLogger(ClientOrderCreationService.class);

  private final ClientOrderCommandPort orders;
  private final TimeProvider clock;
  private final TransactionTemplate write;
  private final TransactionTemplate read;
  private final PushNotificationPort push;
  private final DailyMenuFlag dailyMenuFlag;
  private final DailyMenuReadRepository dailyMenus;

  public ClientOrderCreationService(
      ClientOrderCommandPort orders, TimeProvider clock, PlatformTransactionManager manager) {
    this(orders, clock, manager, PushNotificationPort.NONE);
  }

  public ClientOrderCreationService(
      ClientOrderCommandPort orders,
      TimeProvider clock,
      PlatformTransactionManager manager,
      PushNotificationPort push) {
    this(orders, clock, manager, push, () -> false, null);
  }

  /**
   * Spring: push and the daily menu are optional, so a context without those modules still builds;
   * without the daily menu beans an order with a menu answers DAILY_MENU_DISABLED.
   */
  @Autowired
  public ClientOrderCreationService(
      ClientOrderCommandPort orders,
      TimeProvider clock,
      PlatformTransactionManager manager,
      Optional<PushNotificationPort> push,
      Optional<DailyMenuFlag> dailyMenuFlag,
      Optional<DailyMenuReadRepository> dailyMenus) {
    this(
        orders,
        clock,
        manager,
        push.orElse(PushNotificationPort.NONE),
        dailyMenus.isPresent() ? dailyMenuFlag.orElse(() -> false) : () -> false,
        dailyMenus.orElse(null));
  }

  public ClientOrderCreationService(
      ClientOrderCommandPort orders,
      TimeProvider clock,
      PlatformTransactionManager manager,
      PushNotificationPort push,
      DailyMenuFlag dailyMenuFlag,
      DailyMenuReadRepository dailyMenus) {
    this.push = push;
    this.orders = orders;
    this.clock = clock;
    this.write = transaction(manager, false);
    this.read = transaction(manager, true);
    this.dailyMenuFlag = dailyMenuFlag;
    this.dailyMenus = dailyMenus;
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
    var menu = order.menu();
    if (menu != null) {
      if (!dailyMenuFlag.enabled()) throw ClientOrderException.dailyMenuDisabled();
      if (!date.equals(menu.businessDate())) throw ClientOrderException.dailyMenuDateChanged();
    }
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

    ClientOrderCommandPort.PublishedDailyMenu plate = null;
    List<NewChoice> choices = List.of();
    if (menu != null) {
      // Last in the lock order (§3.4): the day header, then that day's rows.
      plate =
          orders
              .lockPublishedDailyMenu(cafeteria.id(), date)
              .orElseThrow(ClientOrderException::dailyMenuNotPublished);
      choices = choices(cafeteria.id(), date, menu);
      total = total.add(plate.price());
      for (var choice : choices)
        if (choice.extraPrice() != null) total = total.add(choice.extraPrice());
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
    if (plate != null) orders.insertDailyMenu(id, cafeteria.id(), date, plate, choices);
    // Only a new order: an idempotent replay returned above and never notifies twice.
    try {
      push.publish(OrderPushEvent.of(id, OrderPushEvent.Kind.NEW_ORDER));
    } catch (RuntimeException failure) {
      // No push implementation can roll back or fail the order.
      LOG.warn("Push notice NEW_ORDER not scheduled ({})", failure.getClass().getSimpleName());
    }
    return new CreatedOrder(stored(id), true);
  }

  /**
   * One choice per active SINGLE category, an option of that category today or «Ninguna» where it
   * may be skipped; additions switched on today with their frozen price. Template order first, then
   * the additions.
   */
  private List<NewChoice> choices(UUID cafeteriaId, LocalDate date, Menu menu) {
    var categories = dailyMenus.findActiveCategories(cafeteriaId);
    var options = dailyMenus.findOptions(cafeteriaId, date);
    if (!DailyMenuRules.complete(categories, options))
      throw ClientOrderException.dailyMenuNotPublished();
    var byCategory = new HashMap<UUID, Choice>();
    for (var choice : menu.choices()) byCategory.put(choice.categoryId(), choice);
    var lines = new ArrayList<NewChoice>();
    for (var category : DailyMenuRules.singles(categories)) {
      var choice = byCategory.remove(category.id());
      if (choice == null) throw ClientOrderException.dailyMenuSelectionInvalid();
      if (choice.skip()) {
        if (!category.canSkip()) throw ClientOrderException.dailyMenuSelectionInvalid();
        lines.add(new NewChoice("NONE", category.id(), category.label(), null, null, null, null));
        continue;
      }
      var option =
          options.stream()
              .filter(o -> o.id().equals(choice.optionId()) && o.categoryId().equals(category.id()))
              .findFirst()
              .orElseThrow(ClientOrderException::dailyMenuSelectionInvalid);
      lines.add(
          new NewChoice(
              "OPTION", category.id(), category.label(), option.label(), null, option.id(), null));
    }
    // A choice for a category that is not an active SINGLE one of this menu.
    if (!byCategory.isEmpty()) throw ClientOrderException.dailyMenuSelectionInvalid();
    if (!menu.additionIds().isEmpty()) {
      var extras =
          categories.stream()
              .filter(category -> category.kind() == Kind.ADDITIONS)
              .findFirst()
              .orElseThrow(ClientOrderException::dailyMenuAdditionUnavailable);
      var available = new HashMap<UUID, DailyMenuReadRepository.Addition>();
      for (var addition : dailyMenus.findAvailableAdditions(cafeteriaId, date))
        available.put(addition.id(), addition);
      for (var additionId : menu.additionIds()) {
        var addition = available.get(additionId);
        if (addition == null) throw ClientOrderException.dailyMenuAdditionUnavailable();
        lines.add(
            new NewChoice(
                "ADDITION",
                extras.id(),
                extras.label(),
                addition.name(),
                addition.extraPrice(),
                null,
                addition.id()));
      }
    }
    return List.copyOf(lines);
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
      UUID cafeteriaId, List<Line> items, String note, PickupTime pickup, Menu menu, String hash) {

    static Normalized of(String idempotencyKey, OrderRequest request) {
      if (idempotencyKey == null
          || !IDEMPOTENCY_KEY.matcher(idempotencyKey).matches()
          || request == null
          || request.cafeteriaId() == null
          || request.items() == null
          // Without products an order needs the daily menu.
          || (request.items().isEmpty() && request.dailyMenu() == null)
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
      var menu = Menu.of(request.dailyMenu());
      // The plate is one unit of the 15; its additions are not units.
      if (menu != null && units + 1 > MAX_UNITS_PER_ORDER)
        throw ClientOrderException.limitExceeded();

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
          menu,
          hash(request.cafeteriaId(), items, pickup, menu, note));
    }

    /**
     * SHA-256 hex of a canonical form; the note goes last, so it needs no escaping. A pickup time
     * adds one {@code @instant} line before it, which no item line can look like; without one the
     * form is exactly B15's, so the keys already stored keep their hash.
     */
    private static String hash(
        UUID cafeteriaId, List<Line> items, PickupTime pickup, Menu menu, String note) {
      var canonical = new StringBuilder("order-v1\n").append(cafeteriaId).append('\n');
      for (var line : items)
        canonical.append(line.productId()).append(':').append(line.quantity()).append('\n');
      if (pickup != null) canonical.append('@').append(pickup.value()).append('\n');
      // «#» lines exist only with a daily menu, so an order without one keeps its B15 hash.
      if (menu != null) {
        canonical.append("#menu:").append(menu.businessDate()).append('\n');
        for (var choice : menu.choices())
          canonical
              .append("#c:")
              .append(choice.categoryId())
              .append(':')
              .append(choice.skip() ? "-" : choice.optionId())
              .append('\n');
        for (var addition : menu.additionIds())
          canonical.append("#a:").append(addition).append('\n');
      }
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

  /**
   * The daily menu as the server understands it: choices sorted by category and additions sorted,
   * so their order in the body never changes the hash. Repeated categories or additions, or a
   * choice with both an option and «Ninguna» or with neither, are refused, never merged.
   */
  record Menu(LocalDate businessDate, List<Choice> choices, List<UUID> additionIds) {

    static Menu of(DailyMenuRequest request) {
      if (request == null) return null;
      if (request.businessDate() == null
          || request.choices() == null
          || request.additionIds() == null) throw ClientOrderException.invalidRequest();
      if (request.choices().size() > MAX_MENU_LINES
          || request.additionIds().size() > MAX_MENU_LINES)
        throw ClientOrderException.dailyMenuSelectionInvalid();
      var categories = new HashSet<UUID>();
      for (var choice : request.choices()) {
        if (choice == null || choice.categoryId() == null)
          throw ClientOrderException.invalidRequest();
        if (choice.skip() == (choice.optionId() != null) || !categories.add(choice.categoryId()))
          throw ClientOrderException.dailyMenuSelectionInvalid();
      }
      var additions = new ArrayList<UUID>();
      for (var additionId : request.additionIds()) {
        if (additionId == null) throw ClientOrderException.invalidRequest();
        if (additions.contains(additionId)) throw ClientOrderException.dailyMenuSelectionInvalid();
        additions.add(additionId);
      }
      var choices = new ArrayList<>(request.choices());
      choices.sort(Comparator.comparing(choice -> choice.categoryId().toString()));
      additions.sort(Comparator.comparing(UUID::toString));
      return new Menu(request.businessDate(), List.copyOf(choices), List.copyOf(additions));
    }
  }
}

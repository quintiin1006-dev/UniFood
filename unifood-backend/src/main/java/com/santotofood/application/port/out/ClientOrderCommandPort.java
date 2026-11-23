package com.santotofood.application.port.out;

import com.santotofood.application.model.ClientOrder;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * Order creation facts and writes. The lock methods run inside the caller's transaction, in the
 * order of docs/decisiones.md §11: cafeteria (it carries the subscription), products by id, today's
 * rows and, with a daily menu, the day header (docs/propuesta-menu-dinamico.md, section 3.4).
 */
public interface ClientOrderCommandPort {

  /** Active CLIENT account with its client row; empty for anything else. */
  Optional<OrderingClient> findOrderingClient(UUID userId);

  Optional<KeyedOrder> findByIdempotencyKey(UUID clientId, String idempotencyKey);

  Optional<UUID> findActiveOrder(UUID clientId);

  Optional<ClientOrder> findOrder(UUID orderId);

  /** {@code FOR SHARE}; empty when it does not exist or belongs to another institution. */
  Optional<LockedCafeteria> lockCafeteria(UUID institutionId, UUID cafeteriaId);

  /** {@code FOR SHARE} on today's state; no row means closed. */
  boolean lockOpenToday(UUID cafeteriaId, LocalDate businessDate);

  /** {@code FOR SHARE ORDER BY id}; only the products of that cafeteria. */
  List<LockedProduct> lockProducts(UUID cafeteriaId, List<UUID> productIds);

  /** {@code FOR SHARE ORDER BY item_id}; the ids marked available today. */
  Set<UUID> lockAvailableToday(UUID cafeteriaId, List<UUID> productIds, LocalDate businessDate);

  /**
   * {@code FOR SHARE} on the daily menu day header, so a worker write (FOR UPDATE) waits for this
   * order or the order waits for it; never a half-published menu. Empty unless it is published.
   */
  Optional<PublishedDailyMenu> lockPublishedDailyMenu(UUID cafeteriaId, LocalDate businessDate);

  void insertOrder(NewOrder order);

  void insertItems(UUID orderId, UUID cafeteriaId, List<NewItem> items);

  /** order_daily_menus and its choices, in the given order, in the order's transaction. */
  void insertDailyMenu(
      UUID orderId,
      UUID cafeteriaId,
      LocalDate businessDate,
      PublishedDailyMenu plate,
      List<NewChoice> choices);

  record OrderingClient(
      UUID clientId,
      String fullName,
      UUID institutionId,
      String clientType,
      String institutionalCode) {}

  record KeyedOrder(UUID orderId, String requestHash) {}

  record LockedCafeteria(UUID id, boolean active) {}

  record LockedProduct(UUID id, String name, BigDecimal price, boolean active) {}

  /** {@code total} already includes {@code serviceFeeCop}, the fee frozen into the order (033). */
  record NewOrder(
      UUID id,
      UUID cafeteriaId,
      OrderingClient client,
      BigDecimal total,
      String note,
      Instant requestedPickupAt,
      String idempotencyKey,
      String requestHash,
      int serviceFeeCop) {

    public NewOrder(
        UUID id,
        UUID cafeteriaId,
        OrderingClient client,
        BigDecimal total,
        String note,
        Instant requestedPickupAt,
        String idempotencyKey,
        String requestHash) {
      this(id, cafeteriaId, client, total, note, requestedPickupAt, idempotencyKey, requestHash, 0);
    }
  }

  /** The frozen title and plate price of the published day. */
  record PublishedDailyMenu(String title, BigDecimal price) {}

  /** One copied line: OPTION, NONE («Ninguna») or ADDITION, as chk_choice_shape (031) allows. */
  record NewChoice(
      String kind,
      UUID categoryId,
      String categoryLabel,
      String label,
      BigDecimal extraPrice,
      UUID sourceOptionId,
      UUID sourceAdditionId) {}

  record NewItem(UUID productId, String name, BigDecimal unitPrice, int quantity) {
    public BigDecimal subtotal() {
      return unitPrice.multiply(BigDecimal.valueOf(quantity));
    }
  }
}

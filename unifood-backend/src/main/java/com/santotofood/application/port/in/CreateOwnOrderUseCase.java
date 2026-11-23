package com.santotofood.application.port.in;

import com.santotofood.application.model.ClientOrder;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/** B15: a CLIENT creates their own order (docs/decisiones.md §6 and §11). */
public interface CreateOwnOrderUseCase {

  /**
   * Creates a PENDING order for the client behind {@code userId}, or returns the one this {@code
   * idempotencyKey} already created. Prices, totals and availability come from the database; {@code
   * request} only names products, quantities and daily menu choices, and is {@code null} when the
   * body could not be read.
   */
  CreatedOrder createOwnOrder(UUID userId, String idempotencyKey, OrderRequest request);

  /**
   * {@code requestedPickupAt} is the raw ISO-8601 text, or {@code null} for "as soon as possible";
   * the use case parses and validates it. {@code dailyMenu} is null for an order without the daily
   * menu (docs/propuesta-menu-dinamico.md, section 3.2); with it, {@code items} may be empty.
   * {@code expectedServiceFee} is the fee in whole pesos the client was shown (docs/modelo-de-
   * negocio.md), or null when it sent none; it never sets the fee, it only detects a change.
   */
  record OrderRequest(
      UUID cafeteriaId,
      List<Line> items,
      String note,
      String requestedPickupAt,
      DailyMenuRequest dailyMenu,
      Integer expectedServiceFee) {

    public OrderRequest(
        UUID cafeteriaId,
        List<Line> items,
        String note,
        String requestedPickupAt,
        DailyMenuRequest dailyMenu) {
      this(cafeteriaId, items, note, requestedPickupAt, dailyMenu, null);
    }

    public OrderRequest(UUID cafeteriaId, List<Line> items, String note, String requestedPickupAt) {
      this(cafeteriaId, items, note, requestedPickupAt, null, null);
    }

    public OrderRequest(UUID cafeteriaId, List<Line> items, String note) {
      this(cafeteriaId, items, note, null, null, null);
    }
  }

  record Line(UUID productId, int quantity) {}

  /** One plate: the business date the client saw, one choice per category and the additions. */
  record DailyMenuRequest(LocalDate businessDate, List<Choice> choices, List<UUID> additionIds) {}

  /** Either {@code optionId} or {@code skip} («Ninguna»), never both. */
  record Choice(UUID categoryId, UUID optionId, boolean skip) {}

  /** {@code created} is false when the same request was already served under that key. */
  record CreatedOrder(ClientOrder order, boolean created) {}
}

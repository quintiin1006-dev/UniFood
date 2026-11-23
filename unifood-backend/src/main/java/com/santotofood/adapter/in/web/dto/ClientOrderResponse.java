package com.santotofood.adapter.in.web.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.santotofood.application.model.ClientOrder;
import com.santotofood.application.model.OrderDailyMenu;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * docs/decisiones.md §11 order, shared by create, current, detail and cancel. B16 only appends
 * fields after the B15 ones, and {@code requestedPickupAt} (nullable) comes last. Amounts travel as
 * decimal strings; the client's document is never part of it. {@code dailyMenu}
 * (docs/propuesta-menu-dinamico.md, section 3.5) is left out for an order without the daily menu,
 * so those orders answer exactly as before. {@code productsSubtotal} and {@code serviceFee} (033,
 * docs/modelo-de-negocio.md) come last: {@code total} = productsSubtotal + serviceFee, all computed
 * and frozen by the server; serviceFee is "0.00" for orders without a fee.
 */
public record ClientOrderResponse(
    UUID id,
    String status,
    String total,
    String note,
    Instant createdAt,
    List<Item> items,
    Cafeteria cafeteria,
    String cancellationSource,
    String rejectionReason,
    Instant updatedAt,
    Instant calledAt,
    int reminderCount,
    Instant lastRemindedAt,
    Instant deliveredAt,
    Instant notCollectedAt,
    Instant cancelledAt,
    Instant requestedPickupAt,
    @JsonInclude(JsonInclude.Include.NON_NULL) DailyMenu dailyMenu,
    String productsSubtotal,
    String serviceFee) {

  public record Item(String name, int quantity, String unitPrice, String subtotal) {}

  public record DailyMenu(String title, String price, List<DailyMenuChoice> choices) {}

  /** {@code label} is null for «Ninguna»; {@code extraPrice} only for an addition. */
  public record DailyMenuChoice(String category, String kind, String label, String extraPrice) {}

  public record Cafeteria(UUID id, String name) {}

  public static ClientOrderResponse from(ClientOrder order) {
    var timeline = order.timeline();
    return new ClientOrderResponse(
        order.id(),
        order.status(),
        amount(order.total()),
        order.note(),
        order.createdAt(),
        order.items().stream()
            .map(
                item ->
                    new Item(
                        item.name(),
                        item.quantity(),
                        amount(item.unitPrice()),
                        amount(item.subtotal())))
            .toList(),
        new Cafeteria(order.cafeteria().id(), order.cafeteria().name()),
        order.cancellationSource(),
        order.rejectionReason(),
        timeline.updatedAt(),
        timeline.calledAt(),
        timeline.reminderCount(),
        timeline.lastRemindedAt(),
        timeline.deliveredAt(),
        timeline.notCollectedAt(),
        timeline.cancelledAt(),
        order.requestedPickupAt(),
        dailyMenu(order.dailyMenu()),
        amount(order.productsSubtotal()),
        fee(order.serviceFeeCop()));
  }

  static String fee(int pesos) {
    return amount(BigDecimal.valueOf(pesos));
  }

  static DailyMenu dailyMenu(OrderDailyMenu menu) {
    if (menu == null) return null;
    return new DailyMenu(
        menu.title(),
        amount(menu.price()),
        menu.choices().stream()
            .map(
                choice ->
                    new DailyMenuChoice(
                        choice.category(),
                        choice.kind(),
                        choice.label(),
                        choice.extraPrice() == null ? null : amount(choice.extraPrice())))
            .toList());
  }

  static String amount(BigDecimal value) {
    return value.setScale(2, RoundingMode.UNNECESSARY).toPlainString();
  }
}

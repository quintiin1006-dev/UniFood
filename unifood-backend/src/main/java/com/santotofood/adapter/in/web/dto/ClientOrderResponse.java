package com.santotofood.adapter.in.web.dto;

import com.santotofood.application.model.ClientOrder;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * docs/decisiones.md §11 order, shared by create, current, detail and cancel. B16 only appends
 * fields after the B15 ones. Amounts travel as decimal strings; the client's document is never part
 * of it.
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
    Instant cancelledAt) {

  public record Item(String name, int quantity, String unitPrice, String subtotal) {}

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
        timeline.cancelledAt());
  }

  static String amount(BigDecimal value) {
    return value.setScale(2, RoundingMode.UNNECESSARY).toPlainString();
  }
}

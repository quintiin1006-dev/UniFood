package com.santotofood.adapter.in.web.dto;

import com.santotofood.application.model.ClientOrder;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * docs/decisiones.md §11 order, shared by create and the upcoming current order. Amounts travel as
 * decimal strings; the client's document is never part of it.
 */
public record ClientOrderResponse(
    UUID id, String status, String total, String note, Instant createdAt, List<Item> items) {

  public record Item(String name, int quantity, String unitPrice, String subtotal) {}

  public static ClientOrderResponse from(ClientOrder order) {
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
            .toList());
  }

  private static String amount(BigDecimal value) {
    return value.setScale(2, RoundingMode.UNNECESSARY).toPlainString();
  }
}

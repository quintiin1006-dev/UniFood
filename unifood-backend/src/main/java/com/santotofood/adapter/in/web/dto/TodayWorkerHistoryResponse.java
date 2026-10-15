package com.santotofood.adapter.in.web.dto;

import com.santotofood.application.model.TodayWorkerHistory;
import com.santotofood.domain.model.OrderStatus;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

public record TodayWorkerHistoryResponse(
    LocalDate businessDate, Instant nextBusinessDateAt, List<Entry> orders) {
  public record Entry(
      UUID id,
      String reference,
      OrderStatus status,
      Instant completedAt,
      BigDecimal total,
      List<Item> items) {}

  public record Item(String name, int quantity, BigDecimal unitPrice, BigDecimal subtotal) {}

  public static TodayWorkerHistoryResponse from(TodayWorkerHistory history) {
    return new TodayWorkerHistoryResponse(
        history.businessDate().value(),
        history.nextBusinessDateAt(),
        history.orders().stream()
            .map(
                order ->
                    new Entry(
                        order.id(),
                        visualReference(order.id()),
                        order.status(),
                        order.completedAt(),
                        order.total(),
                        order.items().stream()
                            .map(
                                item ->
                                    new Item(
                                        item.name(),
                                        item.quantity(),
                                        item.unitPrice(),
                                        item.subtotal()))
                            .toList()))
            .toList());
  }

  /** Display label only: collisions are possible; UUID is identity, not authorization. */
  private static String visualReference(UUID id) {
    return "Pedido · " + id.toString().replace("-", "").substring(0, 8).toUpperCase(Locale.ROOT);
  }
}

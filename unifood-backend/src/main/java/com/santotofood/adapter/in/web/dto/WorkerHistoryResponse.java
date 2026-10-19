package com.santotofood.adapter.in.web.dto;

import com.santotofood.application.model.WorkerHistory;
import com.santotofood.domain.model.OrderStatus;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

public record WorkerHistoryResponse(
    LocalDate businessDate,
    Instant nextBusinessDateAt,
    LocalDate monthStart,
    LocalDate rangeStart,
    LocalDate rangeEnd,
    List<Entry> orders,
    String nextCursor,
    boolean hasHistory) {
  public record Entry(
      UUID id,
      String reference,
      String clientName,
      OrderStatus status,
      Instant completedAt,
      BigDecimal total,
      List<Item> items) {}

  public record Item(String name, int quantity, BigDecimal unitPrice, BigDecimal subtotal) {}

  public static WorkerHistoryResponse from(WorkerHistory history) {
    return new WorkerHistoryResponse(
        history.businessDate().value(),
        history.nextBusinessDateAt(),
        history.monthStart(),
        history.rangeStart(),
        history.rangeEnd(),
        history.orders().stream()
            .map(
                order ->
                    new Entry(
                        order.id(),
                        visualReference(order.id()),
                        order.clientName(),
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
            .toList(),
        history.nextCursor(),
        history.hasHistory());
  }

  /** Display label only: collisions are possible; UUID is identity, not authorization. */
  private static String visualReference(UUID id) {
    return "Pedido · " + id.toString().replace("-", "").substring(0, 8).toUpperCase(Locale.ROOT);
  }
}

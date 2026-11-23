package com.santotofood.adapter.in.web.dto;

import com.santotofood.application.model.ClientOrderHistory;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * B16 history page (docs/decisiones.md §11); {@code nextCursor} is opaque and null at the end.
 * {@code total} includes {@code serviceFee} (033), appended last; both are decimal strings.
 */
public record ClientOrderHistoryResponse(List<Entry> orders, String nextCursor) {

  public record Entry(
      UUID id,
      String status,
      String total,
      Instant createdAt,
      String cafeteriaName,
      int itemCount,
      String summary,
      String productsSubtotal,
      String serviceFee) {}

  public static ClientOrderHistoryResponse from(ClientOrderHistory history) {
    return new ClientOrderHistoryResponse(
        history.orders().stream()
            .map(
                entry ->
                    new Entry(
                        entry.id(),
                        entry.status(),
                        ClientOrderResponse.amount(entry.total()),
                        entry.createdAt(),
                        entry.cafeteriaName(),
                        entry.itemCount(),
                        entry.summary(),
                        ClientOrderResponse.amount(
                            entry.total().subtract(BigDecimal.valueOf(entry.serviceFeeCop()))),
                        ClientOrderResponse.fee(entry.serviceFeeCop())))
            .toList(),
        history.nextCursor());
  }
}

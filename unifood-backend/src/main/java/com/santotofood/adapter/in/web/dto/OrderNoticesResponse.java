package com.santotofood.adapter.in.web.dto;

import com.santotofood.application.model.OrderNotice;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * The bell inbox: newest first, at most 20, from the last 7 days. {@code unread} counts the unread
 * notices of this same list. Texts are resolved by the web from {@code kind}.
 */
public record OrderNoticesResponse(List<Notice> notices, int unread) {

  public record Notice(
      UUID id,
      String kind,
      int sequence,
      UUID orderId,
      boolean orderActive,
      Instant createdAt,
      boolean read) {}

  public static OrderNoticesResponse of(List<OrderNotice> notices) {
    var items =
        notices.stream()
            .map(
                n ->
                    new Notice(
                        n.id(),
                        n.kind().name(),
                        n.sequence(),
                        n.orderId(),
                        n.orderActive(),
                        n.createdAt(),
                        n.read()))
            .toList();
    return new OrderNoticesResponse(items, (int) notices.stream().filter(n -> !n.read()).count());
  }
}

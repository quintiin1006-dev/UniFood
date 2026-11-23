package com.santotofood.application.port.out;

import com.santotofood.application.model.OrderNotice;
import com.santotofood.application.model.OrderNoticeKind;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

public interface OrderNoticePort {

  /**
   * Stores the notice for the order's own client. A repeated (order, kind, sequence) is ignored,
   * and no failure here may abort the caller's transaction.
   */
  void record(UUID orderId, OrderNoticeKind kind, int sequence, Instant at);

  /** The user's notices created at or after {@code since}, newest first, at most {@code limit}. */
  List<OrderNotice> findRecent(UUID userId, Instant since, int limit);

  /** Marks the user's unread notices as read; returns how many changed. */
  int markRead(UUID userId, Instant at);
}

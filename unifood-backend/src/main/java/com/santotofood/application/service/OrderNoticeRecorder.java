package com.santotofood.application.service;

import com.santotofood.application.model.OrderNoticeKind;
import java.time.Instant;
import java.util.UUID;

/** Called by the order transitions, inside their transaction. Never throws. */
@FunctionalInterface
public interface OrderNoticeRecorder {
  OrderNoticeRecorder NONE = (orderId, kind, sequence, at) -> {};

  void record(UUID orderId, OrderNoticeKind kind, int sequence, Instant at);
}

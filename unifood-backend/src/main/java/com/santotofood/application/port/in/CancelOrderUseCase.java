package com.santotofood.application.port.in;

import com.santotofood.domain.model.Order;
import java.util.UUID;

/** Only the client cancels (docs/decisiones.md §6); the worker will reject instead (B18). */
public interface CancelOrderUseCase {

  /** Own-order cancellation: PENDING only, without a deadline. */
  Order cancelOwnOrder(UUID orderId);
}

package com.santotofood.application.port.in;

import com.santotofood.domain.model.Order;
import java.util.UUID;

public interface CancelOrderUseCase {

  Order cancelOrder(UUID orderId);

  /** Own-order cancellation: PENDING only, without an additional deadline. */
  Order cancelOwnOrder(UUID orderId);
}

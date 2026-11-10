package com.santotofood.application.port.in;

import com.santotofood.application.model.ClientOrder;
import java.util.UUID;

public interface GetOwnOrderUseCase {

  /** Another client's order and a missing one are the same 404. */
  ClientOrder getOwnOrder(UUID userId, UUID orderId);
}

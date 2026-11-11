package com.santotofood.application.port.in;

import com.santotofood.domain.model.Order;
import java.util.UUID;

/** B18: the worker rejects a PENDING or PREPARING order with a reason the client sees. */
public interface RejectOrderUseCase {

  Order rejectOrder(UUID orderId, UUID workerId, String reason);
}

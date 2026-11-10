package com.santotofood.application.port.in;

import com.santotofood.application.model.ClientOrder;
import java.util.Optional;
import java.util.UUID;

public interface GetOwnCurrentOrderUseCase {

  /**
   * The client's active order, tagged for polling. When {@code ifNoneMatch} already holds the tag,
   * the order is not loaded and {@code notModified} is true.
   */
  CurrentOrder getOwnCurrentOrder(UUID userId, String ifNoneMatch);

  record CurrentOrder(String etag, boolean notModified, Optional<ClientOrder> order) {}
}

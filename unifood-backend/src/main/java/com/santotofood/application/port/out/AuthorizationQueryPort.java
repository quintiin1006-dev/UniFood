package com.santotofood.application.port.out;

import com.santotofood.application.model.OrderOwner;
import com.santotofood.application.model.UserAuthorization;
import java.util.Optional;
import java.util.UUID;

/** Minimal current facts required by order authorization, without loading aggregates. */
public interface AuthorizationQueryPort {
  /**
   * Reads facts without eligibility filtering. Cafeteria IDs are distinct and may be bounded at
   * two: a pair represents two or more assignments, never a valid single assignment.
   */
  Optional<UserAuthorization> findUserAuthorization(UUID userId);

  Optional<UUID> findOrderCafeteria(UUID orderId);

  /** Empty means missing order; a null owner means an existing order without a linked client. */
  Optional<OrderOwner> findOrderOwner(UUID orderId);
}

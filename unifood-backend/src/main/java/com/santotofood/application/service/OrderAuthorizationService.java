package com.santotofood.application.service;

import com.santotofood.application.port.out.AuthorizationQueryPort;
import java.util.Optional;
import java.util.UUID;

/** Operational policy uses fresh database facts on every call; no JWT roles or cached context. */
public class OrderAuthorizationService {
  private final AuthorizationQueryPort queries;

  public OrderAuthorizationService(AuthorizationQueryPort queries) {
    this.queries = queries;
  }

  public Optional<UUID> workerCafeteria(UUID userId) {
    return queries
        .findUserAuthorization(userId)
        .filter(
            user ->
                user.active()
                    && user.roles().contains("WORKER")
                    && !user.roles().contains("ADMIN")
                    && !user.roles().contains("SUPER_ADMIN")
                    && user.cafeteriaIds().size() == 1)
        .map(user -> user.cafeteriaIds().getFirst());
  }

  public boolean cafeteria(UUID userId, UUID cafeteriaId) {
    return workerCafeteria(userId).filter(id -> id.equals(cafeteriaId)).isPresent();
  }

  public boolean order(UUID userId, UUID orderId) {
    return queries
        .findOrderCafeteria(orderId)
        .filter(cafeteriaId -> cafeteria(userId, cafeteriaId))
        .isPresent();
  }
}

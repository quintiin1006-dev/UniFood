package com.santotofood.application.service;

import com.santotofood.application.exception.OrderNotFoundException;
import com.santotofood.application.model.CashViews;
import com.santotofood.application.port.out.AuthorizationQueryPort;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/** Order policy uses fresh database facts on every call; no JWT roles or cached context. */
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
                    && user.roles().size() == 1
                    && user.roles().contains("WORKER")
                    && !user.roles().contains("ADMIN")
                    && !user.roles().contains("SUPER_ADMIN")
                    && user.cafeteriaIds().size() == 1)
        .map(user -> user.cafeteriaIds().getFirst());
  }

  public boolean cafeteria(UUID userId, UUID cafeteriaId) {
    return workerCafeteria(userId).filter(id -> id.equals(cafeteriaId)).isPresent();
  }

  public boolean client(UUID userId) {
    return queries
        .findUserAuthorization(userId)
        .filter(user -> user.active() && user.roles().equals(Set.of("CLIENT")))
        .isPresent();
  }

  /**
   * Cash register operator: an active WORKER or ADMIN, with that role only and exactly one
   * cafeteria (docs/decisiones.md §14). Read fresh on every call.
   */
  public Optional<CashViews.Operator> cashOperator(UUID userId) {
    return queries
        .findUserAuthorization(userId)
        .filter(
            user ->
                user.active()
                    && (user.roles().equals(Set.of("WORKER"))
                        || user.roles().equals(Set.of("ADMIN")))
                    && user.cafeteriaIds().size() == 1)
        .map(
            user ->
                new CashViews.Operator(
                    userId, user.cafeteriaIds().getFirst(), user.roles().contains("ADMIN")));
  }

  /** Active, exclusive SUPER_ADMIN without cafeteria assignments, read fresh on every call. */
  public boolean superAdmin(UUID userId) {
    return queries
        .findUserAuthorization(userId)
        .filter(
            user ->
                user.active()
                    && user.roles().equals(Set.of("SUPER_ADMIN"))
                    && user.cafeteriaIds().isEmpty())
        .isPresent();
  }

  public boolean clientOrder(UUID userId, UUID orderId) {
    if (!client(userId)) return false;
    var owner =
        queries.findOrderOwner(orderId).orElseThrow(() -> new OrderNotFoundException(orderId));
    if (!userId.equals(owner.userId())) throw new OrderNotFoundException(orderId);
    return true;
  }

  public boolean order(UUID userId, UUID orderId) {
    return queries
        .findOrderCafeteria(orderId)
        .filter(cafeteriaId -> cafeteria(userId, cafeteriaId))
        .isPresent();
  }
}

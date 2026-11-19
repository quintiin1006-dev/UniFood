package com.santotofood.domain.model;

import java.util.Objects;
import java.util.UUID;

/**
 * One order transition worth a push notification. It carries identifiers only: who receives it, and
 * every text, is resolved after the transaction commits, from the database.
 *
 * <p>{@code sequence} tells repeated events of the same kind apart (the reminder number); it is 0
 * for every other kind. {@code (orderId, kind, sequence)} is the deduplication key.
 */
public record OrderPushEvent(UUID orderId, Kind kind, int sequence) {

  public enum Kind {
    /** A new PENDING order, for the cafeteria's workers. */
    NEW_ORDER(Audience.WORKERS),
    PREPARING(Audience.CLIENT),
    READY(Audience.CLIENT),
    CALLED(Audience.CLIENT),
    REMINDER(Audience.CLIENT),
    REJECTED(Audience.CLIENT),
    NOT_COLLECTED(Audience.CLIENT),
    /** The worker handed the order over (jj/cliente-ajustes · G). */
    DELIVERED(Audience.CLIENT);

    private final Audience audience;

    Kind(Audience audience) {
      this.audience = audience;
    }

    public Audience audience() {
      return audience;
    }
  }

  public enum Audience {
    CLIENT,
    WORKERS
  }

  public OrderPushEvent {
    Objects.requireNonNull(orderId);
    Objects.requireNonNull(kind);
    if (sequence < 0) throw new IllegalArgumentException("sequence must not be negative");
  }

  public static OrderPushEvent of(UUID orderId, Kind kind) {
    return new OrderPushEvent(orderId, kind, 0);
  }

  /** The client-facing event of a status an order has just reached, if that status has one. */
  public static java.util.Optional<OrderPushEvent> forStatus(Order order) {
    if (order == null || order.getStatus() == null || order.getId() == null)
      return java.util.Optional.empty();
    Kind kind =
        switch (order.getStatus()) {
          case PREPARING -> Kind.PREPARING;
          case READY -> Kind.READY;
          case CALLED -> Kind.CALLED;
          case NOT_COLLECTED -> Kind.NOT_COLLECTED;
          case DELIVERED -> Kind.DELIVERED;
          default -> null;
        };
    return java.util.Optional.ofNullable(kind).map(k -> of(order.getId(), k));
  }

  public String deduplicationKey() {
    return orderId + ":" + kind + ":" + sequence;
  }
}

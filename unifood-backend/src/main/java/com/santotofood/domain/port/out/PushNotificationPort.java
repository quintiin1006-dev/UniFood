package com.santotofood.domain.port.out;

import com.santotofood.domain.model.OrderPushEvent;

/**
 * Push notifications to the user's devices, in addition to the in-app notice, which stays the
 * primary channel (docs/decisiones.md §7).
 *
 * <p>Contract for every implementation: {@link #publish} never throws, never blocks on the network,
 * and delivers nothing unless the caller's transaction commits. A push that fails is logged and
 * dropped; it can never undo or delay the order transition that produced it.
 */
public interface PushNotificationPort {

  /** Push disabled: used where no delivery is configured (tests, missing VAPID keys). */
  PushNotificationPort NONE = event -> {};

  void publish(OrderPushEvent event);
}

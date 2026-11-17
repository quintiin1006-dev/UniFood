package com.santotofood.application.port.out;

import com.santotofood.application.model.PushRecipient;
import com.santotofood.application.model.PushSubscriberRole;
import com.santotofood.application.model.PushSubscriptionRegistration;
import com.santotofood.domain.model.OrderPushEvent;
import java.util.List;
import java.util.UUID;

public interface PushSubscriptionPort {

  /**
   * Inserts or reactivates the endpoint for {@code userId}. An endpoint another account registered
   * on the same browser moves to this account. Serialized per user with the device limit, so two
   * parallel registrations never leave more than {@code maxDevices} active.
   */
  UUID upsert(
      UUID userId,
      PushSubscriberRole role,
      UUID cafeteriaId,
      PushSubscriptionRegistration registration,
      int maxDevices);

  /** Revokes the user's own endpoint; another account's endpoint is never touched. */
  boolean revokeOwnEndpoint(UUID userId, String endpoint);

  /** Revokes the user's own subscription by id (sign-out, from the web server's cookie). */
  boolean revokeOwnSubscription(UUID userId, UUID subscriptionId);

  /** Active devices of the order's client or of the order cafeteria's active workers. */
  List<PushRecipient> findRecipients(UUID orderId, OrderPushEvent.Audience audience);

  /** The push service answered 404/410: the subscription no longer exists. */
  void markGone(UUID subscriptionId);
}

package com.santotofood.application.port.in;

import com.santotofood.application.model.PushSubscriberRole;
import com.santotofood.application.model.PushSubscriptionRegistration;
import java.util.UUID;

public interface ManagePushSubscriptionsUseCase {
  int MAX_ACTIVE_DEVICES = 5;

  /** Registers the device for the authenticated user, as the role the database grants. */
  UUID subscribe(
      UUID authenticatedUserId, PushSubscriberRole role, PushSubscriptionRegistration device);

  /** Exactly one of endpoint or subscriptionId; only the user's own rows. */
  boolean unsubscribe(UUID authenticatedUserId, String endpoint, UUID subscriptionId);
}

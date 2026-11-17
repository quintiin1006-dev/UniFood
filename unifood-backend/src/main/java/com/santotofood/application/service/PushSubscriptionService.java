package com.santotofood.application.service;

import com.santotofood.application.exception.PushSubscriptionException;
import com.santotofood.application.model.PushSubscriberRole;
import com.santotofood.application.model.PushSubscriptionRegistration;
import com.santotofood.application.port.in.ManagePushSubscriptionsUseCase;
import com.santotofood.application.port.out.PushSubscriptionPort;
import com.santotofood.domain.port.out.TimeProvider;
import java.time.Duration;
import java.util.Objects;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Registers and removes the authenticated user's devices. The user, the role and the worker's
 * cafeteria come from the database on every call (OrderAuthorizationService), never from the
 * request body or the JWT claims.
 */
@Service
public class PushSubscriptionService implements ManagePushSubscriptionsUseCase {
  /** Registrations and removals per user and minute: a page reload never needs more. */
  public static final int REQUESTS_PER_MINUTE = 10;

  private final OrderAuthorizationService authorization;
  private final PushSubscriptionPort subscriptions;
  private final SlidingWindowLimiter limiter;

  @Autowired
  public PushSubscriptionService(
      OrderAuthorizationService authorization,
      PushSubscriptionPort subscriptions,
      TimeProvider clock) {
    this(
        authorization,
        subscriptions,
        new SlidingWindowLimiter(REQUESTS_PER_MINUTE, Duration.ofMinutes(1), clock));
  }

  public PushSubscriptionService(
      OrderAuthorizationService authorization,
      PushSubscriptionPort subscriptions,
      SlidingWindowLimiter limiter) {
    this.authorization = authorization;
    this.subscriptions = subscriptions;
    this.limiter = limiter;
  }

  @Override
  @Transactional(isolation = Isolation.REPEATABLE_READ, timeout = 15)
  public UUID subscribe(
      UUID authenticatedUserId, PushSubscriberRole role, PushSubscriptionRegistration device) {
    Objects.requireNonNull(authenticatedUserId);
    Objects.requireNonNull(role);
    if (!limiter.tryAcquire(authenticatedUserId)) throw PushSubscriptionException.rateLimited();
    UUID cafeteria =
        switch (role) {
          case CLIENT -> {
            if (!authorization.client(authenticatedUserId))
              throw PushSubscriptionException.forbidden();
            yield null;
          }
          case WORKER ->
              authorization
                  .workerCafeteria(authenticatedUserId)
                  .orElseThrow(PushSubscriptionException::forbidden);
        };
    var clean = validated(device);
    return subscriptions.upsert(authenticatedUserId, role, cafeteria, clean, MAX_ACTIVE_DEVICES);
  }

  @Override
  @Transactional(timeout = 15)
  public boolean unsubscribe(UUID authenticatedUserId, String endpoint, UUID subscriptionId) {
    Objects.requireNonNull(authenticatedUserId);
    // Any signed-in account may remove its own devices, even after losing its role: sign-out
    // must always be able to stop the notifications of this browser.
    if (!limiter.tryAcquire(authenticatedUserId)) throw PushSubscriptionException.rateLimited();
    if ((endpoint == null) == (subscriptionId == null)) throw PushSubscriptionException.invalid();
    if (subscriptionId != null)
      return subscriptions.revokeOwnSubscription(authenticatedUserId, subscriptionId);
    if (endpoint.isEmpty() || endpoint.length() > PushEndpointPolicy.MAX_ENDPOINT_LENGTH)
      throw PushSubscriptionException.invalid();
    return subscriptions.revokeOwnEndpoint(authenticatedUserId, endpoint);
  }

  private static PushSubscriptionRegistration validated(PushSubscriptionRegistration device) {
    if (device == null
        || !PushEndpointPolicy.allowedEndpoint(device.endpoint())
        || !PushEndpointPolicy.validKeys(device.p256dh(), device.auth()))
      throw PushSubscriptionException.invalid();
    String agent = device.userAgent();
    if (agent != null) {
      agent = agent.replaceAll("\\p{Cntrl}", " ").strip();
      if (agent.length() > PushEndpointPolicy.MAX_USER_AGENT_LENGTH)
        agent = agent.substring(0, PushEndpointPolicy.MAX_USER_AGENT_LENGTH);
      if (agent.isEmpty()) agent = null;
    }
    return new PushSubscriptionRegistration(
        device.endpoint(), device.p256dh(), device.auth(), agent);
  }
}

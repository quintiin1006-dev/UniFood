package com.santotofood.adapter.in.web.dto;

import java.util.UUID;

/** Bodies of the push subscription endpoints; the user always comes from the token. */
public final class PushSubscriptionRequests {
  private PushSubscriptionRequests() {}

  /** The shape of the browser's PushSubscription.toJSON(), plus the optional user agent. */
  public record Subscribe(String endpoint, Keys keys, String userAgent) {}

  public record Keys(String p256dh, String auth) {}

  /** Exactly one of endpoint (the browser's own) or subscriptionId (sign-out, from a cookie). */
  public record Unsubscribe(String endpoint, UUID subscriptionId) {}

  public record Subscribed(UUID subscriptionId) {}

  public record PublicKey(String publicKey) {}
}

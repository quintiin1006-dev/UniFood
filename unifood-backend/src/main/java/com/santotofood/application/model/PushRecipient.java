package com.santotofood.application.model;

import java.util.UUID;

/** One active device that must receive a push, resolved after the order transition commits. */
public record PushRecipient(
    UUID subscriptionId, UUID userId, String channel, String endpoint, String p256dh, String auth) {

  @Override
  public String toString() {
    // Endpoints and keys are capabilities: they never reach a log through toString().
    return "PushRecipient[" + subscriptionId + ", " + channel + "]";
  }
}

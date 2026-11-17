package com.santotofood.adapter.out.push;

import com.santotofood.application.model.PushRecipient;

/**
 * One delivery channel behind PushNotificationPort. WEB_PUSH is the only one implemented; a future
 * FCM sender (native app) registers here with channel() = "FCM" and needs no other change in the
 * dispatcher or the table (migration 027).
 */
public interface PushChannelSender {

  enum Result {
    DELIVERED,
    /** 404/410: the subscription no longer exists and is revoked. */
    GONE,
    /** Timeout, network error, 429 or 5xx: worth a limited retry. */
    RETRYABLE,
    /** Any other refusal (400, 401, 403, 413...): retrying would fail the same way. */
    REJECTED
  }

  String channel();

  /** Never throws for a delivery problem; returns the outcome instead. */
  Result send(PushRecipient recipient, PushMessage message);
}

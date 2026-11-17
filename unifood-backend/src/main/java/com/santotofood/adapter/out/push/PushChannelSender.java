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

  /**
   * The outcome plus the push service's HTTP status when there was a response; null when none
   * arrived (timeout, network, a message that could not be built or a refused endpoint). The reason
   * is the short token Apple sends on a 4xx (e.g. "BadJwtToken"), or null when none was read. Only
   * these two values are exposed: never the endpoint, keys or the rest of the body.
   */
  record Delivery(Result result, Integer httpStatus, String reason) {
    public Delivery(Result result, Integer httpStatus) {
      this(result, httpStatus, null);
    }
  }

  String channel();

  /** Never throws for a delivery problem; returns the outcome instead. */
  Result send(PushRecipient recipient, PushMessage message);

  /** Same as {@link #send}, with the HTTP status when the channel knows it. */
  default Delivery deliver(PushRecipient recipient, PushMessage message) {
    return new Delivery(send(recipient, message), null);
  }
}

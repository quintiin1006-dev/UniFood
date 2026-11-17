package com.santotofood.application.exception;

/** Push subscription refusals; messages are fixed and never echo the endpoint. */
public class PushSubscriptionException extends RuntimeException {
  public enum Kind {
    FORBIDDEN,
    INVALID,
    RATE_LIMITED
  }

  private final Kind kind;

  private PushSubscriptionException(Kind kind) {
    super("Push subscription refused: " + kind, null, false, false);
    this.kind = kind;
  }

  public static PushSubscriptionException forbidden() {
    return new PushSubscriptionException(Kind.FORBIDDEN);
  }

  public static PushSubscriptionException invalid() {
    return new PushSubscriptionException(Kind.INVALID);
  }

  public static PushSubscriptionException rateLimited() {
    return new PushSubscriptionException(Kind.RATE_LIMITED);
  }

  public Kind kind() {
    return kind;
  }
}

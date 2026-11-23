package com.santotofood.application.exception;

/** Inbox refusals; messages are fixed. */
public class OrderNoticeException extends RuntimeException {
  public enum Kind {
    DISABLED,
    FORBIDDEN
  }

  private final Kind kind;

  private OrderNoticeException(Kind kind) {
    super("Order notices refused: " + kind, null, false, false);
    this.kind = kind;
  }

  public static OrderNoticeException disabled() {
    return new OrderNoticeException(Kind.DISABLED);
  }

  public static OrderNoticeException forbidden() {
    return new OrderNoticeException(Kind.FORBIDDEN);
  }

  public Kind kind() {
    return kind;
  }
}

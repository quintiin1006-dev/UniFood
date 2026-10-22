package com.santotofood.application.exception;

public class AdminCatalogCommandException extends RuntimeException {
  public enum Reason {
    INVALID_REQUEST,
    NOT_FOUND,
    STALE_VERSION,
    DUPLICATE_NAME,
    CAFETERIA_INACTIVE
  }

  private final Reason reason;

  public AdminCatalogCommandException(Reason reason) {
    super(reason.name());
    this.reason = reason;
  }

  public Reason reason() {
    return reason;
  }
}

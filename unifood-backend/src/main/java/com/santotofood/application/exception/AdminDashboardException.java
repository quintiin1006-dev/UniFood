package com.santotofood.application.exception;

public class AdminDashboardException extends RuntimeException {
  public enum Reason {
    INVALID_REQUEST,
    FORBIDDEN
  }

  private final Reason reason;

  public AdminDashboardException(Reason reason) {
    super("Admin dashboard request rejected");
    this.reason = reason;
  }

  public Reason reason() {
    return reason;
  }
}

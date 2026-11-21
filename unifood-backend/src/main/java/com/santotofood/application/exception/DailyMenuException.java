package com.santotofood.application.exception;

import com.santotofood.shared.error.ErrorCode;

/** Daily menu reads that cannot be served. Both answer 404 with a fixed public message. */
public class DailyMenuException extends RuntimeException {
  private final ErrorCode code;

  private DailyMenuException(ErrorCode code, String message) {
    super(message);
    this.code = code;
  }

  public static DailyMenuException disabled() {
    return new DailyMenuException(
        ErrorCode.DAILY_MENU_DISABLED, "El menú del día no está disponible por ahora.");
  }

  public static DailyMenuException notPublished() {
    return new DailyMenuException(
        ErrorCode.DAILY_MENU_NOT_PUBLISHED, "Hoy todavía no hay menú del día publicado.");
  }

  public ErrorCode getCode() {
    return code;
  }
}

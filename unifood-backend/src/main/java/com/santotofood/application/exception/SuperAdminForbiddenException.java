package com.santotofood.application.exception;

/** The authenticated user is not an active, exclusive SUPER_ADMIN. */
public class SuperAdminForbiddenException extends RuntimeException {
  public SuperAdminForbiddenException() {
    super("Super admin access denied");
  }
}

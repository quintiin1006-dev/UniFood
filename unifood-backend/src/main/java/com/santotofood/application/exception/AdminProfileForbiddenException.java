package com.santotofood.application.exception;

/** No optional profile is missing: the authenticated user lacks a valid ADMIN context. */
public class AdminProfileForbiddenException extends RuntimeException {
  public AdminProfileForbiddenException() {
    super("Admin profile access denied");
  }
}

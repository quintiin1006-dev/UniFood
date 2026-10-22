package com.santotofood.application.exception;

public class AdminCatalogForbiddenException extends RuntimeException {
  public AdminCatalogForbiddenException() {
    super("Admin catalog access denied");
  }
}

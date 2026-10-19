package com.santotofood.application.exception;

/** Invalid public criteria, distinct from a corrupt persistence projection. */
public class InvalidWorkerHistoryRequestException extends IllegalArgumentException {
  public InvalidWorkerHistoryRequestException() {
    super("Invalid worker history request");
  }
}

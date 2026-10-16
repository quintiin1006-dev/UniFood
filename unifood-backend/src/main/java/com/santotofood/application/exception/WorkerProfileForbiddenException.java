package com.santotofood.application.exception;

/** No optional profile is missing: the authenticated user lacks a valid WORKER context. */
public class WorkerProfileForbiddenException extends RuntimeException {
  public WorkerProfileForbiddenException() {
    super("Worker profile access denied");
  }
}

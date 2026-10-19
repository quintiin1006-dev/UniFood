package com.santotofood.adapter.in.web.error;

import com.santotofood.adapter.in.web.WorkerHistoryController;
import com.santotofood.application.exception.InvalidWorkerHistoryRequestException;
import com.santotofood.shared.error.ErrorCode;
import jakarta.servlet.http.HttpServletRequest;
import java.time.Instant;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.dao.TransientDataAccessException;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.transaction.CannotCreateTransactionException;
import org.springframework.transaction.TransactionTimedOutException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@Order(Ordered.HIGHEST_PRECEDENCE)
@RestControllerAdvice(assignableTypes = WorkerHistoryController.class)
public class WorkerHistoryExceptionHandler {
  private static final Logger LOG = LoggerFactory.getLogger(WorkerHistoryExceptionHandler.class);

  @ExceptionHandler(InvalidWorkerHistoryRequestException.class)
  public ResponseEntity<ApiErrorResponse> invalid(HttpServletRequest request) {
    return response(
        HttpStatus.BAD_REQUEST,
        ErrorCode.WORKER_HISTORY_INVALID_REQUEST,
        "Los filtros o la página del historial ya no son válidos. Actualiza el historial e inténtalo nuevamente.",
        request);
  }

  @ExceptionHandler(AccessDeniedException.class)
  public ResponseEntity<ApiErrorResponse> denied(HttpServletRequest request) {
    return response(
        HttpStatus.FORBIDDEN,
        ErrorCode.WORKER_HISTORY_FORBIDDEN,
        "No tienes permisos para consultar este historial.",
        request);
  }

  @ExceptionHandler({
    DataAccessResourceFailureException.class,
    TransientDataAccessException.class,
    CannotCreateTransactionException.class,
    TransactionTimedOutException.class
  })
  public ResponseEntity<ApiErrorResponse> unavailable(HttpServletRequest request) {
    var result =
        response(
            HttpStatus.SERVICE_UNAVAILABLE,
            ErrorCode.WORKER_HISTORY_TEMPORARILY_UNAVAILABLE,
            "No pudimos cargar el historial en este momento. Inténtalo nuevamente.",
            request);
    return ResponseEntity.status(result.getStatusCode())
        .headers(result.getHeaders())
        .header("Retry-After", "5")
        .body(result.getBody());
  }

  @ExceptionHandler(Exception.class)
  public ResponseEntity<ApiErrorResponse> unexpected(
      Exception exception, HttpServletRequest request) {
    LOG.error("Worker history request failed", exception);
    return response(
        HttpStatus.INTERNAL_SERVER_ERROR,
        ErrorCode.WORKER_HISTORY_INTERNAL_ERROR,
        "No pudimos cargar el historial.",
        request);
  }

  private ResponseEntity<ApiErrorResponse> response(
      HttpStatus status, ErrorCode code, String message, HttpServletRequest request) {
    return ResponseEntity.status(status)
        .cacheControl(CacheControl.noStore())
        .body(
            new ApiErrorResponse(
                status.value(), code.name(), message, Instant.now(), request.getRequestURI()));
  }
}

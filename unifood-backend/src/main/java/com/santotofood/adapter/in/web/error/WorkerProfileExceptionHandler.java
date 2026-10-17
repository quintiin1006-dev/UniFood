package com.santotofood.adapter.in.web.error;

import com.santotofood.adapter.in.web.WorkerProfileController;
import com.santotofood.application.exception.WorkerProfileForbiddenException;
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
@RestControllerAdvice(assignableTypes = WorkerProfileController.class)
public class WorkerProfileExceptionHandler {
  private static final Logger LOG = LoggerFactory.getLogger(WorkerProfileExceptionHandler.class);

  @ExceptionHandler({AccessDeniedException.class, WorkerProfileForbiddenException.class})
  public ResponseEntity<ApiErrorResponse> denied(HttpServletRequest request) {
    return response(
        HttpStatus.FORBIDDEN,
        ErrorCode.WORKER_PROFILE_FORBIDDEN,
        "No tienes permisos para consultar este perfil.",
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
            ErrorCode.WORKER_PROFILE_TEMPORARILY_UNAVAILABLE,
            "No pudimos cargar tu perfil en este momento. Inténtalo nuevamente.",
            request);
    return ResponseEntity.status(result.getStatusCode())
        .headers(result.getHeaders())
        .header("Retry-After", "5")
        .body(result.getBody());
  }

  @ExceptionHandler(Exception.class)
  public ResponseEntity<ApiErrorResponse> unexpected(
      Exception exception, HttpServletRequest request) {
    LOG.error("Worker profile request failed", exception);
    return response(
        HttpStatus.INTERNAL_SERVER_ERROR,
        ErrorCode.WORKER_PROFILE_INTERNAL_ERROR,
        "No pudimos cargar tu perfil.",
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

package com.santotofood.adapter.in.web.error;

import com.santotofood.adapter.in.web.AdminServiceFeeController;
import com.santotofood.adapter.in.web.SuperAdminServiceFeeController;
import com.santotofood.application.exception.ServiceFeeException;
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

/** Fixed errors of the service fee endpoints; never a raw exception, always no-store. */
@Order(Ordered.HIGHEST_PRECEDENCE)
@RestControllerAdvice(
    assignableTypes = {SuperAdminServiceFeeController.class, AdminServiceFeeController.class})
public class ServiceFeeExceptionHandler {
  private static final Logger LOG = LoggerFactory.getLogger(ServiceFeeExceptionHandler.class);

  @ExceptionHandler(AccessDeniedException.class)
  public ResponseEntity<ApiErrorResponse> denied(HttpServletRequest request) {
    return response(
        HttpStatus.FORBIDDEN,
        ErrorCode.SERVICE_FEE_FORBIDDEN,
        "No tienes permisos para ver el cargo por servicio.",
        request);
  }

  @ExceptionHandler(ServiceFeeException.class)
  public ResponseEntity<ApiErrorResponse> fee(
      ServiceFeeException exception, HttpServletRequest request) {
    var status =
        switch (exception.kind()) {
          case BAD_REQUEST -> HttpStatus.BAD_REQUEST;
          case FORBIDDEN -> HttpStatus.FORBIDDEN;
          case NOT_FOUND -> HttpStatus.NOT_FOUND;
          case CONFLICT -> HttpStatus.CONFLICT;
          case GONE -> HttpStatus.GONE;
        };
    return response(status, exception.code(), exception.getMessage(), request);
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
            ErrorCode.SERVICE_FEE_TEMPORARILY_UNAVAILABLE,
            "No pudimos cargar el cargo por servicio en este momento. Inténtalo nuevamente.",
            request);
    return ResponseEntity.status(result.getStatusCode())
        .headers(result.getHeaders())
        .header("Retry-After", "5")
        .body(result.getBody());
  }

  @ExceptionHandler(Exception.class)
  public ResponseEntity<ApiErrorResponse> unexpected(
      Exception exception, HttpServletRequest request) {
    LOG.error("Service fee request failed", exception);
    return response(
        HttpStatus.INTERNAL_SERVER_ERROR,
        ErrorCode.SERVICE_FEE_INTERNAL_ERROR,
        "No pudimos cargar el cargo por servicio.",
        request);
  }

  static ResponseEntity<ApiErrorResponse> response(
      HttpStatus status, ErrorCode code, String message, HttpServletRequest request) {
    return ResponseEntity.status(status)
        .cacheControl(CacheControl.noStore())
        .body(
            new ApiErrorResponse(
                status.value(), code.name(), message, Instant.now(), request.getRequestURI()));
  }
}

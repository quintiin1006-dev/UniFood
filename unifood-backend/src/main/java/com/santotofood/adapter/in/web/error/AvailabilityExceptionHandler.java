package com.santotofood.adapter.in.web.error;

import com.santotofood.adapter.in.web.AvailabilityController;
import com.santotofood.application.exception.AvailabilityException;
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
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.transaction.CannotCreateTransactionException;
import org.springframework.transaction.TransactionTimedOutException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingRequestHeaderException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

@Order(Ordered.HIGHEST_PRECEDENCE)
@RestControllerAdvice(assignableTypes = AvailabilityController.class)
public class AvailabilityExceptionHandler {
  private static final Logger LOG = LoggerFactory.getLogger(AvailabilityExceptionHandler.class);

  @ExceptionHandler(AvailabilityException.class)
  public ResponseEntity<ApiErrorResponse> business(
      AvailabilityException exception, HttpServletRequest request) {
    HttpStatus status =
        switch (exception.getCode()) {
          case AVAILABILITY_INVALID_REQUEST -> HttpStatus.BAD_REQUEST;
          case AVAILABILITY_ITEM_NOT_FOUND, AVAILABILITY_CAFETERIA_NOT_FOUND ->
              HttpStatus.NOT_FOUND;
          case AVAILABILITY_DAY_EXPIRED,
              AVAILABILITY_CAFETERIA_INACTIVE,
              AVAILABILITY_ITEM_INACTIVE ->
              HttpStatus.CONFLICT;
          default -> HttpStatus.INTERNAL_SERVER_ERROR;
        };
    return response(status, exception.getCode(), exception.getMessage(), request);
  }

  @ExceptionHandler(AccessDeniedException.class)
  public ResponseEntity<ApiErrorResponse> denied(HttpServletRequest request) {
    return response(
        HttpStatus.FORBIDDEN,
        ErrorCode.AVAILABILITY_FORBIDDEN,
        "No tienes permisos para gestionar esta disponibilidad.",
        request);
  }

  @ExceptionHandler({
    MissingRequestHeaderException.class,
    MethodArgumentTypeMismatchException.class,
    MethodArgumentNotValidException.class,
    HttpMessageNotReadableException.class
  })
  public ResponseEntity<ApiErrorResponse> invalid(HttpServletRequest request) {
    return response(
        HttpStatus.BAD_REQUEST,
        ErrorCode.AVAILABILITY_INVALID_REQUEST,
        "Revisa el estado solicitado y la fecha de la pantalla.",
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
            ErrorCode.AVAILABILITY_TEMPORARILY_UNAVAILABLE,
            "No pudimos gestionar la disponibilidad en este momento. Inténtalo nuevamente.",
            request);
    return ResponseEntity.status(result.getStatusCode())
        .headers(result.getHeaders())
        .header("Retry-After", "5")
        .body(result.getBody());
  }

  @ExceptionHandler(Exception.class)
  public ResponseEntity<ApiErrorResponse> unexpected(
      Exception exception, HttpServletRequest request) {
    LOG.error("Availability request failed", exception);
    return response(
        HttpStatus.INTERNAL_SERVER_ERROR,
        ErrorCode.AVAILABILITY_INTERNAL_ERROR,
        "No pudimos gestionar la disponibilidad.",
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

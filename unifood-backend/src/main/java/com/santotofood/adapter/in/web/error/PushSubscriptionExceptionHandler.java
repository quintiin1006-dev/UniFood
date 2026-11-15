package com.santotofood.adapter.in.web.error;

import com.santotofood.adapter.in.web.PushSubscriptionController;
import com.santotofood.application.exception.PushSubscriptionException;
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
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/** Fixed Spanish messages; nothing from the request body is ever echoed or logged. */
@Order(Ordered.HIGHEST_PRECEDENCE)
@RestControllerAdvice(assignableTypes = PushSubscriptionController.class)
public class PushSubscriptionExceptionHandler {
  private static final Logger LOG = LoggerFactory.getLogger(PushSubscriptionExceptionHandler.class);

  @ExceptionHandler(AccessDeniedException.class)
  public ResponseEntity<ApiErrorResponse> denied(HttpServletRequest request) {
    return forbidden(request);
  }

  @ExceptionHandler(PushSubscriptionException.class)
  public ResponseEntity<ApiErrorResponse> refused(
      PushSubscriptionException exception, HttpServletRequest request) {
    return switch (exception.kind()) {
      case FORBIDDEN -> forbidden(request);
      case INVALID -> invalid(request);
      case RATE_LIMITED -> {
        var result =
            response(
                HttpStatus.TOO_MANY_REQUESTS,
                ErrorCode.PUSH_RATE_LIMITED,
                "Hiciste demasiados cambios en los avisos. Espera un minuto e inténtalo de nuevo.",
                request);
        yield ResponseEntity.status(result.getStatusCode())
            .headers(result.getHeaders())
            .header("Retry-After", "60")
            .body(result.getBody());
      }
    };
  }

  @ExceptionHandler(HttpMessageNotReadableException.class)
  public ResponseEntity<ApiErrorResponse> unreadable(HttpServletRequest request) {
    return invalid(request);
  }

  @ExceptionHandler(PushSubscriptionController.PushDisabledException.class)
  public ResponseEntity<ApiErrorResponse> disabled(HttpServletRequest request) {
    return response(
        HttpStatus.SERVICE_UNAVAILABLE,
        ErrorCode.PUSH_DISABLED,
        "Los avisos al teléfono no están disponibles por ahora. Seguirás viendo los avisos en la app.",
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
            ErrorCode.PUSH_TEMPORARILY_UNAVAILABLE,
            "No pudimos guardar tus avisos en este momento. Inténtalo nuevamente.",
            request);
    return ResponseEntity.status(result.getStatusCode())
        .headers(result.getHeaders())
        .header("Retry-After", "5")
        .body(result.getBody());
  }

  @ExceptionHandler(Exception.class)
  public ResponseEntity<ApiErrorResponse> unexpected(
      Exception exception, HttpServletRequest request) {
    // Only the type: a message could contain the endpoint the browser sent.
    LOG.error("Push subscription request failed ({})", exception.getClass().getName());
    return response(
        HttpStatus.INTERNAL_SERVER_ERROR,
        ErrorCode.PUSH_INTERNAL_ERROR,
        "No pudimos guardar tus avisos.",
        request);
  }

  private ResponseEntity<ApiErrorResponse> forbidden(HttpServletRequest request) {
    return response(
        HttpStatus.FORBIDDEN,
        ErrorCode.PUSH_FORBIDDEN,
        "No puedes activar avisos desde esta cuenta.",
        request);
  }

  private ResponseEntity<ApiErrorResponse> invalid(HttpServletRequest request) {
    return response(
        HttpStatus.BAD_REQUEST,
        ErrorCode.PUSH_SUBSCRIPTION_INVALID,
        "Este navegador entregó una suscripción de avisos no válida.",
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

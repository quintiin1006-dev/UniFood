package com.santotofood.adapter.in.web.error;

import com.santotofood.adapter.in.web.OrderNoticeController;
import com.santotofood.application.exception.OrderNoticeException;
import com.santotofood.shared.error.ErrorCode;
import jakarta.servlet.http.HttpServletRequest;
import java.time.Instant;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.dao.TransientDataAccessException;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/** Fixed codes and messages for the inbox; no raw error leaves. */
@Order(Ordered.HIGHEST_PRECEDENCE)
@RestControllerAdvice(assignableTypes = OrderNoticeController.class)
public class OrderNoticeExceptionHandler {

  @ExceptionHandler(OrderNoticeException.class)
  public ResponseEntity<ApiErrorResponse> refused(
      OrderNoticeException exception, HttpServletRequest request) {
    return switch (exception.kind()) {
      case DISABLED ->
          response(
              HttpStatus.NOT_FOUND,
              ErrorCode.ORDER_NOTICES_DISABLED.name(),
              "Los avisos recientes no están disponibles.",
              request);
      case FORBIDDEN -> forbidden(request);
    };
  }

  @ExceptionHandler(AccessDeniedException.class)
  public ResponseEntity<ApiErrorResponse> denied(HttpServletRequest request) {
    return forbidden(request);
  }

  @ExceptionHandler({DataAccessResourceFailureException.class, TransientDataAccessException.class})
  public ResponseEntity<ApiErrorResponse> unavailable(HttpServletRequest request) {
    var result =
        response(
            HttpStatus.SERVICE_UNAVAILABLE,
            ErrorCode.ORDER_NOTICES_TEMPORARILY_UNAVAILABLE.name(),
            "No pudimos cargar tus avisos en este momento. Inténtalo nuevamente.",
            request);
    return ResponseEntity.status(result.getStatusCode())
        .headers(result.getHeaders())
        .header("Retry-After", "5")
        .body(result.getBody());
  }

  private ResponseEntity<ApiErrorResponse> forbidden(HttpServletRequest request) {
    return response(
        HttpStatus.FORBIDDEN,
        ErrorCode.ORDER_NOTICES_FORBIDDEN.name(),
        "No tienes permisos para consultar estos avisos.",
        request);
  }

  private ResponseEntity<ApiErrorResponse> response(
      HttpStatus status, String code, String message, HttpServletRequest request) {
    return ResponseEntity.status(status)
        .cacheControl(CacheControl.noStore())
        .body(
            new ApiErrorResponse(
                status.value(), code, message, Instant.now(), request.getRequestURI()));
  }
}

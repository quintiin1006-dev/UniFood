package com.santotofood.adapter.in.web.error;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.santotofood.adapter.in.web.ClientOrderController;
import com.santotofood.application.exception.ClientOrderException;
import jakarta.servlet.http.HttpServletRequest;
import java.time.Instant;
import java.util.UUID;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * Order creation errors. Only {@link ClientOrderException} is handled here, so the cancel endpoint
 * on the same controller keeps the global handling it already had.
 */
@Order(Ordered.HIGHEST_PRECEDENCE)
@RestControllerAdvice(assignableTypes = ClientOrderController.class)
public class ClientOrderExceptionHandler {

  /**
   * ApiErrorResponse plus {@code activeOrderId}, present only for ACTIVE_ORDER_EXISTS
   * (docs/decisiones.md §11).
   */
  @JsonInclude(JsonInclude.Include.NON_NULL)
  public record ClientOrderErrorResponse(
      int status,
      String code,
      String message,
      Instant timestamp,
      String path,
      UUID activeOrderId) {}

  @ExceptionHandler(ClientOrderException.class)
  public ResponseEntity<ClientOrderErrorResponse> order(
      ClientOrderException exception, HttpServletRequest request) {
    var status =
        switch (exception.getKind()) {
          case FORBIDDEN -> HttpStatus.FORBIDDEN;
          case BAD_REQUEST -> HttpStatus.BAD_REQUEST;
          case NOT_FOUND -> HttpStatus.NOT_FOUND;
          case CONFLICT -> HttpStatus.CONFLICT;
          case UNAVAILABLE -> HttpStatus.SERVICE_UNAVAILABLE;
        };
    var response = ResponseEntity.status(status).cacheControl(CacheControl.noStore());
    if (status == HttpStatus.SERVICE_UNAVAILABLE) response.header("Retry-After", "5");
    return response.body(
        new ClientOrderErrorResponse(
            status.value(),
            exception.getCode(),
            exception.getMessage(),
            Instant.now(),
            request.getRequestURI(),
            exception.getActiveOrderId()));
  }
}

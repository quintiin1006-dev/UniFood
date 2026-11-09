package com.santotofood.adapter.in.web.error;

import com.santotofood.adapter.in.web.ClientCatalogController;
import com.santotofood.application.exception.ClientCatalogException;
import com.santotofood.application.exception.ClientProfileNotFoundException;
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
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

@Order(Ordered.HIGHEST_PRECEDENCE)
@RestControllerAdvice(assignableTypes = ClientCatalogController.class)
public class ClientCatalogExceptionHandler {
  @ExceptionHandler(ClientCatalogException.class)
  public ResponseEntity<ApiErrorResponse> catalog(
      ClientCatalogException exception, HttpServletRequest request) {
    var status =
        exception.getCode() == ErrorCode.CAFETERIA_NOT_SUBSCRIBED
            ? HttpStatus.FORBIDDEN
            : HttpStatus.NOT_FOUND;
    return response(status, exception.getCode().name(), exception.getMessage(), request);
  }

  @ExceptionHandler(ClientProfileNotFoundException.class)
  public ResponseEntity<ApiErrorResponse> missing(
      ClientProfileNotFoundException exception, HttpServletRequest request) {
    return response(
        HttpStatus.NOT_FOUND, exception.getCode().name(), exception.getMessage(), request);
  }

  @ExceptionHandler({
    MissingServletRequestParameterException.class,
    MethodArgumentTypeMismatchException.class
  })
  public ResponseEntity<ApiErrorResponse> invalid(HttpServletRequest request) {
    return response(
        HttpStatus.BAD_REQUEST, "INVALID_REQUEST", "Selecciona una cafetería válida.", request);
  }

  @ExceptionHandler(AccessDeniedException.class)
  public ResponseEntity<ApiErrorResponse> denied(HttpServletRequest request) {
    return response(
        HttpStatus.FORBIDDEN, "FORBIDDEN", "No tienes permisos para consultar el menú.", request);
  }

  @ExceptionHandler({DataAccessResourceFailureException.class, TransientDataAccessException.class})
  public ResponseEntity<ApiErrorResponse> unavailable(HttpServletRequest request) {
    var result =
        response(
            HttpStatus.SERVICE_UNAVAILABLE,
            ErrorCode.CLIENT_CATALOG_TEMPORARILY_UNAVAILABLE.name(),
            "No pudimos cargar el menú en este momento. Inténtalo nuevamente.",
            request);
    return ResponseEntity.status(result.getStatusCode())
        .headers(result.getHeaders())
        .header("Retry-After", "5")
        .body(result.getBody());
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

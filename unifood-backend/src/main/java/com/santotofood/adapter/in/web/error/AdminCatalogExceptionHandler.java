package com.santotofood.adapter.in.web.error;

import com.santotofood.adapter.in.web.AdminCatalogController;
import com.santotofood.application.exception.AdminCatalogCommandException;
import com.santotofood.application.exception.AdminCatalogForbiddenException;
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
@RestControllerAdvice(assignableTypes = AdminCatalogController.class)
public class AdminCatalogExceptionHandler {
  private static final Logger LOG = LoggerFactory.getLogger(AdminCatalogExceptionHandler.class);

  @ExceptionHandler(AdminCatalogCommandException.class)
  public ResponseEntity<ApiErrorResponse> command(
      AdminCatalogCommandException exception, HttpServletRequest request) {
    return switch (exception.reason()) {
      case INVALID_REQUEST ->
          response(
              HttpStatus.BAD_REQUEST,
              ErrorCode.ADMIN_CATALOG_INVALID_REQUEST,
              "Revisa los datos del producto.",
              request);
      case NOT_FOUND ->
          response(
              HttpStatus.NOT_FOUND,
              ErrorCode.ADMIN_CATALOG_PRODUCT_NOT_FOUND,
              "El producto no está disponible en tu catálogo.",
              request);
      case STALE_VERSION ->
          response(
              HttpStatus.CONFLICT,
              ErrorCode.ADMIN_CATALOG_STALE_VERSION,
              "El producto cambió. Actualiza el catálogo antes de guardar.",
              request);
      case DUPLICATE_NAME ->
          response(
              HttpStatus.CONFLICT,
              ErrorCode.ADMIN_CATALOG_DUPLICATE_NAME,
              "Ya existe un producto con ese nombre en tu cafetería.",
              request);
      case CAFETERIA_INACTIVE ->
          response(
              HttpStatus.FORBIDDEN,
              ErrorCode.ADMIN_CATALOG_CAFETERIA_INACTIVE,
              "La cafetería está inactiva. Los cambios están deshabilitados.",
              request);
    };
  }

  @ExceptionHandler({AccessDeniedException.class, AdminCatalogForbiddenException.class})
  public ResponseEntity<ApiErrorResponse> denied(HttpServletRequest request) {
    return response(
        HttpStatus.FORBIDDEN,
        ErrorCode.ADMIN_CATALOG_FORBIDDEN,
        "No tienes permisos para consultar este catálogo.",
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
            ErrorCode.ADMIN_CATALOG_TEMPORARILY_UNAVAILABLE,
            "No pudimos cargar tu catálogo en este momento. Inténtalo nuevamente.",
            request);
    return ResponseEntity.status(result.getStatusCode())
        .headers(result.getHeaders())
        .header("Retry-After", "5")
        .body(result.getBody());
  }

  @ExceptionHandler(Exception.class)
  public ResponseEntity<ApiErrorResponse> unexpected(
      Exception exception, HttpServletRequest request) {
    LOG.error("Admin catalog request failed", exception);
    return response(
        HttpStatus.INTERNAL_SERVER_ERROR,
        ErrorCode.ADMIN_CATALOG_INTERNAL_ERROR,
        "No pudimos cargar tu catálogo.",
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

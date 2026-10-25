package com.santotofood.adapter.in.web.error;

import com.santotofood.adapter.in.web.AdminDashboardController;
import com.santotofood.application.exception.AdminDashboardException;
import jakarta.servlet.http.HttpServletRequest;
import java.time.Instant;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.dao.TransientDataAccessException;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.transaction.CannotCreateTransactionException;
import org.springframework.transaction.TransactionTimedOutException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@Order(Ordered.HIGHEST_PRECEDENCE)
@RestControllerAdvice(assignableTypes = AdminDashboardController.class)
public class AdminDashboardExceptionHandler {
  private static final Logger LOG = LoggerFactory.getLogger(AdminDashboardExceptionHandler.class);

  @ExceptionHandler(AdminDashboardException.class)
  public ResponseEntity<ApiErrorResponse> rejected(
      AdminDashboardException exception, HttpServletRequest r) {
    return exception.reason() == AdminDashboardException.Reason.INVALID_REQUEST
        ? response(400, "ADMIN_DASHBOARD_INVALID_REQUEST", "Revisa los filtros del período.", r)
        : response(
            403,
            "ADMIN_DASHBOARD_FORBIDDEN",
            "No tienes permisos para consultar este dashboard.",
            r);
  }

  @ExceptionHandler(AccessDeniedException.class)
  public ResponseEntity<ApiErrorResponse> denied(HttpServletRequest r) {
    return response(
        403, "ADMIN_DASHBOARD_FORBIDDEN", "No tienes permisos para consultar este dashboard.", r);
  }

  @ExceptionHandler({
    DataAccessResourceFailureException.class,
    TransientDataAccessException.class,
    CannotCreateTransactionException.class,
    TransactionTimedOutException.class
  })
  public ResponseEntity<ApiErrorResponse> unavailable(HttpServletRequest r) {
    var result =
        response(
            503,
            "ADMIN_DASHBOARD_TEMPORARILY_UNAVAILABLE",
            "No pudimos cargar el dashboard. Inténtalo nuevamente.",
            r);
    return ResponseEntity.status(503)
        .headers(result.getHeaders())
        .header("Retry-After", "5")
        .body(result.getBody());
  }

  @ExceptionHandler(Exception.class)
  public ResponseEntity<ApiErrorResponse> unexpected(Exception exception, HttpServletRequest r) {
    LOG.error("Admin dashboard request failed", exception);
    return response(500, "ADMIN_DASHBOARD_INTERNAL_ERROR", "No pudimos cargar el dashboard.", r);
  }

  private ResponseEntity<ApiErrorResponse> response(
      int status, String code, String message, HttpServletRequest r) {
    return ResponseEntity.status(status)
        .cacheControl(CacheControl.noStore())
        .body(new ApiErrorResponse(status, code, message, Instant.now(), r.getRequestURI()));
  }
}

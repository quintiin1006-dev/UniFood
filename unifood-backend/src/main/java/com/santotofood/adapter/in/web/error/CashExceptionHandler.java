package com.santotofood.adapter.in.web.error;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.santotofood.adapter.in.web.CashController;
import com.santotofood.adapter.in.web.SuperAdminCashController;
import com.santotofood.adapter.in.web.dto.CashResponses;
import com.santotofood.application.exception.CashException;
import com.santotofood.shared.error.ErrorCode;
import jakarta.servlet.http.HttpServletRequest;
import java.time.Instant;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.dao.CannotAcquireLockException;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.dao.PessimisticLockingFailureException;
import org.springframework.dao.TransientDataAccessException;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.UncategorizedSQLException;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.transaction.CannotCreateTransactionException;
import org.springframework.transaction.TransactionTimedOutException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@Order(Ordered.HIGHEST_PRECEDENCE)
@RestControllerAdvice(assignableTypes = {CashController.class, SuperAdminCashController.class})
public class CashExceptionHandler {
  private static final Logger LOG = LoggerFactory.getLogger(CashExceptionHandler.class);

  /**
   * ApiErrorResponse plus {@code pendingOrders} (CASH_PENDING_ORDERS) and {@code preview}
   * (CASH_EXPECTED_CHANGED), present only for those codes.
   */
  @JsonInclude(JsonInclude.Include.NON_NULL)
  public record CashErrorResponse(
      int status,
      String code,
      String message,
      Instant timestamp,
      String path,
      List<CashResponses.PendingOrder> pendingOrders,
      CashResponses.Preview preview) {}

  @ExceptionHandler(AccessDeniedException.class)
  public ResponseEntity<CashErrorResponse> denied(HttpServletRequest request) {
    var exception = CashException.forbidden();
    return response(HttpStatus.FORBIDDEN, exception.code(), exception.getMessage(), request);
  }

  @ExceptionHandler(CashException.class)
  public ResponseEntity<CashErrorResponse> cash(
      CashException exception, HttpServletRequest request) {
    var status =
        switch (exception.kind()) {
          case BAD_REQUEST -> HttpStatus.BAD_REQUEST;
          case FORBIDDEN -> HttpStatus.FORBIDDEN;
          case NOT_FOUND -> HttpStatus.NOT_FOUND;
          case CONFLICT -> HttpStatus.CONFLICT;
        };
    return ResponseEntity.status(status)
        .cacheControl(CacheControl.noStore())
        .body(
            new CashErrorResponse(
                status.value(),
                exception.code().name(),
                exception.getMessage(),
                Instant.now(),
                request.getRequestURI(),
                CashResponses.pending(exception.pendingOrders()),
                exception.preview() == null ? null : CashResponses.preview(exception.preview())));
  }

  /** lock_timeout (028 flow) or a lock conflict: another operation holds the drawer. */
  @ExceptionHandler({CannotAcquireLockException.class, PessimisticLockingFailureException.class})
  public ResponseEntity<CashErrorResponse> busy(HttpServletRequest request) {
    var result =
        response(
            HttpStatus.CONFLICT,
            ErrorCode.CASH_BUSY,
            "La caja está ocupada con otra operación. Inténtalo de nuevo en unos segundos.",
            request);
    return ResponseEntity.status(result.getStatusCode())
        .headers(result.getHeaders())
        .header("Retry-After", "3")
        .body(result.getBody());
  }

  /**
   * PostgreSQL reports lock_timeout as SQLSTATE 55P03, which Spring may leave uncategorized: it is
   * the same CASH_BUSY. Anything else stays an internal error.
   */
  @ExceptionHandler(UncategorizedSQLException.class)
  public ResponseEntity<CashErrorResponse> uncategorized(
      UncategorizedSQLException exception, HttpServletRequest request) {
    var cause = exception.getSQLException();
    if (cause != null && "55P03".equals(cause.getSQLState())) return busy(request);
    return unexpected(exception, request);
  }

  /** A unique index of 028 won a race the locks should already prevent. */
  @ExceptionHandler(DuplicateKeyException.class)
  public ResponseEntity<CashErrorResponse> duplicate(HttpServletRequest request) {
    var exception = CashException.stateChanged();
    return response(HttpStatus.CONFLICT, exception.code(), exception.getMessage(), request);
  }

  @ExceptionHandler({
    DataAccessResourceFailureException.class,
    TransientDataAccessException.class,
    CannotCreateTransactionException.class,
    TransactionTimedOutException.class
  })
  public ResponseEntity<CashErrorResponse> unavailable(HttpServletRequest request) {
    var result =
        response(
            HttpStatus.SERVICE_UNAVAILABLE,
            ErrorCode.CASH_TEMPORARILY_UNAVAILABLE,
            "No pudimos conectar con la caja en este momento. Inténtalo nuevamente.",
            request);
    return ResponseEntity.status(result.getStatusCode())
        .headers(result.getHeaders())
        .header("Retry-After", "5")
        .body(result.getBody());
  }

  @ExceptionHandler(Exception.class)
  public ResponseEntity<CashErrorResponse> unexpected(
      Exception exception, HttpServletRequest request) {
    LOG.error("Cash request failed", exception);
    return response(
        HttpStatus.INTERNAL_SERVER_ERROR,
        ErrorCode.CASH_INTERNAL_ERROR,
        "No pudimos completar la operación de caja.",
        request);
  }

  private ResponseEntity<CashErrorResponse> response(
      HttpStatus status, ErrorCode code, String message, HttpServletRequest request) {
    return ResponseEntity.status(status)
        .cacheControl(CacheControl.noStore())
        .body(
            new CashErrorResponse(
                status.value(),
                code.name(),
                message,
                Instant.now(),
                request.getRequestURI(),
                null,
                null));
  }
}

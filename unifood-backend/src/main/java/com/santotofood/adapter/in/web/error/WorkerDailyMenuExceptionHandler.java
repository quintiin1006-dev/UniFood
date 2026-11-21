package com.santotofood.adapter.in.web.error;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.santotofood.adapter.in.web.WorkerDailyMenuController;
import com.santotofood.application.exception.DailyMenuException;
import com.santotofood.shared.error.ErrorCode;
import jakarta.servlet.http.HttpServletRequest;
import java.time.Instant;
import java.util.List;
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

/** Codes and statuses of docs/propuesta-menu-dinamico.md section 3.6; no raw error leaves. */
@Order(Ordered.HIGHEST_PRECEDENCE)
@RestControllerAdvice(assignableTypes = WorkerDailyMenuController.class)
public class WorkerDailyMenuExceptionHandler {
  private static final Logger LOG = LoggerFactory.getLogger(WorkerDailyMenuExceptionHandler.class);

  /** ApiErrorResponse plus {@code missingCategories}, present only for DAILY_MENU_INCOMPLETE. */
  @JsonInclude(JsonInclude.Include.NON_NULL)
  public record DailyMenuErrorResponse(
      int status,
      String code,
      String message,
      Instant timestamp,
      String path,
      List<String> missingCategories) {}

  @ExceptionHandler(DailyMenuException.class)
  public ResponseEntity<DailyMenuErrorResponse> business(
      DailyMenuException exception, HttpServletRequest request) {
    HttpStatus status =
        switch (exception.getCode()) {
          case DAILY_MENU_OPTION_INVALID,
              DAILY_MENU_OPTION_DUPLICATED,
              DAILY_MENU_TEXT_TOO_LONG,
              DAILY_MENU_INVALID_REQUEST ->
              HttpStatus.BAD_REQUEST;
          case DAILY_MENU_DISABLED, DAILY_MENU_NOT_PUBLISHED, DAILY_MENU_CATEGORY_NOT_FOUND ->
              HttpStatus.NOT_FOUND;
          case DAILY_MENU_VERSION_CONFLICT,
              DAILY_MENU_INCOMPLETE,
              DAILY_MENU_PRICE_NOT_SET,
              DAILY_MENU_ADDITION_UNAVAILABLE,
              DAILY_MENU_DATE_CHANGED ->
              HttpStatus.CONFLICT;
          default -> HttpStatus.INTERNAL_SERVER_ERROR;
        };
    return response(
        status,
        exception.getCode(),
        exception.getMessage(),
        request,
        exception.getMissingCategories());
  }

  @ExceptionHandler(AccessDeniedException.class)
  public ResponseEntity<DailyMenuErrorResponse> denied(HttpServletRequest request) {
    return response(
        HttpStatus.FORBIDDEN,
        ErrorCode.DAILY_MENU_FORBIDDEN,
        "No tienes permisos para gestionar el menú del día.",
        request,
        null);
  }

  @ExceptionHandler({
    MissingRequestHeaderException.class,
    MethodArgumentTypeMismatchException.class,
    MethodArgumentNotValidException.class,
    HttpMessageNotReadableException.class
  })
  public ResponseEntity<DailyMenuErrorResponse> invalid(HttpServletRequest request) {
    return response(
        HttpStatus.BAD_REQUEST,
        ErrorCode.DAILY_MENU_INVALID_REQUEST,
        "Revisa los datos del menú y la fecha de la pantalla.",
        request,
        null);
  }

  @ExceptionHandler({
    DataAccessResourceFailureException.class,
    TransientDataAccessException.class,
    CannotCreateTransactionException.class,
    TransactionTimedOutException.class
  })
  public ResponseEntity<DailyMenuErrorResponse> unavailable(HttpServletRequest request) {
    var result =
        response(
            HttpStatus.SERVICE_UNAVAILABLE,
            ErrorCode.DAILY_MENU_TEMPORARILY_UNAVAILABLE,
            "No pudimos guardar el menú en este momento. Inténtalo nuevamente.",
            request,
            null);
    return ResponseEntity.status(result.getStatusCode())
        .headers(result.getHeaders())
        .header("Retry-After", "5")
        .body(result.getBody());
  }

  @ExceptionHandler(Exception.class)
  public ResponseEntity<DailyMenuErrorResponse> unexpected(
      Exception exception, HttpServletRequest request) {
    LOG.error("Worker daily menu request failed", exception);
    return response(
        HttpStatus.INTERNAL_SERVER_ERROR,
        ErrorCode.DAILY_MENU_INTERNAL_ERROR,
        "No pudimos gestionar el menú del día.",
        request,
        null);
  }

  private ResponseEntity<DailyMenuErrorResponse> response(
      HttpStatus status,
      ErrorCode code,
      String message,
      HttpServletRequest request,
      List<String> missingCategories) {
    return ResponseEntity.status(status)
        .cacheControl(CacheControl.noStore())
        .body(
            new DailyMenuErrorResponse(
                status.value(),
                code.name(),
                message,
                Instant.now(),
                request.getRequestURI(),
                missingCategories));
  }
}

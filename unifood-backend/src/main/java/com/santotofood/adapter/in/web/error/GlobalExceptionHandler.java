package com.santotofood.adapter.in.web.error;

import com.santotofood.application.exception.OrderNotFoundException;
import com.santotofood.application.exception.OrderProcessingSequenceException;
import com.santotofood.domain.exception.DomainException;
import jakarta.servlet.http.HttpServletRequest;
import java.time.Instant;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

@RestControllerAdvice
public class GlobalExceptionHandler {

  private static final Logger LOGGER = LoggerFactory.getLogger(GlobalExceptionHandler.class);

  @ExceptionHandler(OrderNotFoundException.class)
  public ResponseEntity<ApiErrorResponse> handleOrderNotFoundException(
      OrderNotFoundException exception, HttpServletRequest request) {

    return buildResponse(
        HttpStatus.NOT_FOUND, exception.getCode().name(), exception.getMessage(), request);
  }

  @ExceptionHandler(DomainException.class)
  public ResponseEntity<ApiErrorResponse> handleDomainException(
      DomainException exception, HttpServletRequest request) {

    return buildResponse(
        HttpStatus.CONFLICT, exception.getCode().name(), exception.getMessage(), request);
  }

  @ExceptionHandler(MethodArgumentNotValidException.class)
  public ResponseEntity<ApiErrorResponse> handleValidationException(
      MethodArgumentNotValidException exception, HttpServletRequest request) {

    String message =
        exception.getBindingResult().getFieldErrors().stream()
            .findFirst()
            .map(error -> error.getField() + ": " + error.getDefaultMessage())
            .orElse("La solicitud contiene datos inválidos");

    return buildResponse(HttpStatus.BAD_REQUEST, "INVALID_REQUEST", message, request);
  }

  @ExceptionHandler(MethodArgumentTypeMismatchException.class)
  public ResponseEntity<ApiErrorResponse> handleTypeMismatchException(
      MethodArgumentTypeMismatchException exception, HttpServletRequest request) {

    return buildResponse(
        HttpStatus.BAD_REQUEST,
        "INVALID_REQUEST",
        "El valor proporcionado para '" + exception.getName() + "' no tiene el formato esperado",
        request);
  }

  @ExceptionHandler(HttpMessageNotReadableException.class)
  public ResponseEntity<ApiErrorResponse> handleUnreadableRequest(
      HttpMessageNotReadableException exception, HttpServletRequest request) {

    return buildResponse(
        HttpStatus.BAD_REQUEST,
        "INVALID_REQUEST",
        "El cuerpo de la solicitud no tiene un formato válido",
        request);
  }

  @ExceptionHandler(AccessDeniedException.class)
  public ResponseEntity<ApiErrorResponse> handleAccessDeniedException(
      AccessDeniedException exception, HttpServletRequest request) {
    return buildResponse(
        HttpStatus.FORBIDDEN,
        "FORBIDDEN",
        "No tienes permisos para realizar esta operación",
        request);
  }

  @ExceptionHandler(IllegalStateException.class)
  public ResponseEntity<ApiErrorResponse> handleIllegalStateException(
      IllegalStateException exception, HttpServletRequest request) {

    LOGGER.error(
        "Unexpected application state while processing {} {}",
        request.getMethod(),
        request.getRequestURI(),
        exception);

    return buildResponse(
        HttpStatus.INTERNAL_SERVER_ERROR,
        "INTERNAL_ERROR",
        "Ocurrió un error interno al procesar la solicitud",
        request);
  }

  @ExceptionHandler(Exception.class)
  public ResponseEntity<ApiErrorResponse> handleUnexpectedException(
      Exception exception, HttpServletRequest request) {

    LOGGER.error(
        "Unexpected error while processing {} {}",
        request.getMethod(),
        request.getRequestURI(),
        exception);

    return buildResponse(
        HttpStatus.INTERNAL_SERVER_ERROR,
        "INTERNAL_ERROR",
        "Ocurrió un error interno al procesar la solicitud",
        request);
  }

  private ResponseEntity<ApiErrorResponse> buildResponse(
      HttpStatus status, String code, String message, HttpServletRequest request) {

    ApiErrorResponse response =
        new ApiErrorResponse(status.value(), code, message, Instant.now(), request.getRequestURI());

    return ResponseEntity.status(status).body(response);
  }

  @ExceptionHandler(OrderProcessingSequenceException.class)
  public ResponseEntity<ApiErrorResponse> handleOrderProcessingSequenceException(
      OrderProcessingSequenceException exception, HttpServletRequest request) {

    return buildResponse(
        HttpStatus.CONFLICT, exception.getCode().name(), exception.getMessage(), request);
  }
}

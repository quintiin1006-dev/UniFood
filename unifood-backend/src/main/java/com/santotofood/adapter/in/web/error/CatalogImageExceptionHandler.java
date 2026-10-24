package com.santotofood.adapter.in.web.error;

import com.santotofood.adapter.in.web.AdminCatalogImageController;
import com.santotofood.application.exception.AdminCatalogCommandException;
import com.santotofood.application.exception.CatalogImageException;
import java.util.Map;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MaxUploadSizeExceededException;

@Order(Ordered.HIGHEST_PRECEDENCE)
@RestControllerAdvice(assignableTypes = AdminCatalogImageController.class)
public class CatalogImageExceptionHandler {
  @ExceptionHandler(CatalogImageException.class)
  public ResponseEntity<?> image(CatalogImageException e) {
    return safe(e.status(), e.code());
  }

  @ExceptionHandler(MaxUploadSizeExceededException.class)
  public ResponseEntity<?> size() {
    return safe(413, "ADMIN_CATALOG_IMAGE_TOO_LARGE");
  }

  @ExceptionHandler({
    org.springframework.web.bind.MissingRequestHeaderException.class,
    org.springframework.web.multipart.MultipartException.class,
    org.springframework.http.converter.HttpMessageNotReadableException.class,
    AdminCatalogCommandException.class
  })
  public ResponseEntity<?> invalid() {
    return safe(400, "ADMIN_CATALOG_IMAGE_INVALID_REQUEST");
  }

  @ExceptionHandler(org.springframework.web.HttpMediaTypeNotSupportedException.class)
  public ResponseEntity<?> media() {
    return safe(415, "ADMIN_CATALOG_IMAGE_UNSUPPORTED_FORMAT");
  }

  @ExceptionHandler(org.springframework.security.access.AccessDeniedException.class)
  public ResponseEntity<?> denied() {
    return safe(403, "ADMIN_CATALOG_FORBIDDEN");
  }

  @ExceptionHandler({
    org.springframework.dao.DataAccessException.class,
    org.springframework.transaction.TransactionException.class,
    java.io.IOException.class
  })
  public ResponseEntity<?> unavailable() {
    return safe(503, "ADMIN_CATALOG_IMAGE_TEMPORARILY_UNAVAILABLE");
  }

  @ExceptionHandler(Exception.class)
  public ResponseEntity<?> unexpected() {
    return safe(500, "ADMIN_CATALOG_IMAGE_INTERNAL_ERROR");
  }

  private ResponseEntity<?> safe(int status, String code) {
    var response = ResponseEntity.status(status).cacheControl(CacheControl.noStore());
    if (status == 503) response.header("Retry-After", "5");
    return response.body(
        Map.of(
            "status",
            status,
            "code",
            code,
            "message",
            "No pudimos completar la operación de imagen. Revisa el resultado antes de reintentar."));
  }
}

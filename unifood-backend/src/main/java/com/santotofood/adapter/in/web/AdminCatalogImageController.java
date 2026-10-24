package com.santotofood.adapter.in.web;

import com.santotofood.adapter.in.web.dto.AdminCatalogRequests;
import com.santotofood.adapter.in.web.dto.AdminCatalogResponse;
import com.santotofood.application.exception.CatalogImageException;
import com.santotofood.application.model.CatalogImage.Result;
import com.santotofood.application.service.AdminCatalogImageService;
import com.santotofood.application.service.ProductImageNormalizer;
import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.util.*;
import org.springframework.http.*;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartHttpServletRequest;
import tools.jackson.core.StreamReadFeature;
import tools.jackson.databind.json.JsonMapper;

@RestController
@RequestMapping("/api/admin/catalog/{productId}")
@PreAuthorize("isAuthenticated()")
public class AdminCatalogImageController {
  private final AdminCatalogImageService images;

  public AdminCatalogImageController(AdminCatalogImageService images) {
    this.images = images;
  }

  public record OperationResponse(
      UUID operationId,
      String state,
      String appliedVersion,
      Integer failureStatus,
      String failureCode,
      AdminCatalogResponse.Product product) {}

  private OperationResponse body(Result result) {
    var op = result.operation();
    return new OperationResponse(
        op.id(),
        op.state(),
        op.appliedVersion() == null ? null : op.appliedVersion().toString(),
        op.failureStatus(),
        op.failureCode(),
        AdminCatalogResponse.product(result.product()));
  }

  private ResponseEntity<OperationResponse> response(Result result) {
    int status =
        result.operation().state().equals("PROCESSING")
            ? 202
            : result.operation().state().equals("REJECTED")
                ? result.operation().failureStatus()
                : 200;
    return ResponseEntity.status(status).cacheControl(CacheControl.noStore()).body(body(result));
  }

  @PutMapping(value = "/image", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
  public ResponseEntity<OperationResponse> upload(
      @AuthenticationPrincipal Jwt jwt,
      @PathVariable String productId,
      @RequestHeader("Idempotency-Key") String key,
      MultipartHttpServletRequest request)
      throws IOException {
    if (!request.getMultiFileMap().keySet().equals(Set.of("file"))
        || request.getFiles("file").size() != 1
        || !request.getParameterMap().keySet().equals(Set.of("expectedVersion"))
        || request.getParameterValues("expectedVersion").length != 1)
      throw CatalogImageException.invalid();
    var file = request.getFile("file");
    if (file == null || file.getSize() > ProductImageNormalizer.MAX_BYTES)
      throw new CatalogImageException(413, "ADMIN_CATALOG_IMAGE_TOO_LARGE");
    byte[] bytes;
    try (var stream = file.getInputStream()) {
      bytes = stream.readNBytes(ProductImageNormalizer.MAX_BYTES + 1);
    }
    return response(
        images.upload(
            subject(jwt),
            AdminCatalogRequests.id(productId),
            AdminCatalogRequests.id(key),
            version(request.getParameter("expectedVersion")),
            bytes,
            file.getContentType()));
  }

  @DeleteMapping(value = "/image", consumes = MediaType.APPLICATION_JSON_VALUE)
  public ResponseEntity<OperationResponse> remove(
      @AuthenticationPrincipal Jwt jwt,
      @PathVariable String productId,
      @RequestHeader("Idempotency-Key") String key,
      HttpServletRequest request)
      throws IOException {
    byte[] bytes = request.getInputStream().readNBytes(1025);
    if (bytes.length > 1024) throw CatalogImageException.invalid();
    Map<?, ?> data;
    try {
      data =
          JsonMapper.builder()
              .enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION)
              .enable(tools.jackson.databind.DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
              .build()
              .readValue(bytes, Map.class);
    } catch (RuntimeException e) {
      throw CatalogImageException.invalid();
    }
    if (data == null
        || !data.keySet().equals(Set.of("expectedVersion"))
        || !(data.get("expectedVersion") instanceof String)) throw CatalogImageException.invalid();
    return response(
        images.remove(
            subject(jwt),
            AdminCatalogRequests.id(productId),
            AdminCatalogRequests.id(key),
            version((String) data.get("expectedVersion"))));
  }

  @GetMapping("/image-operations/{operationId}")
  public ResponseEntity<OperationResponse> operation(
      @AuthenticationPrincipal Jwt jwt,
      @PathVariable String productId,
      @PathVariable String operationId) {
    return ResponseEntity.ok()
        .cacheControl(CacheControl.noStore())
        .body(
            body(
                images.operation(
                    subject(jwt),
                    AdminCatalogRequests.id(productId),
                    AdminCatalogRequests.id(operationId))));
  }

  @GetMapping("/image/{imageId}")
  public ResponseEntity<byte[]> image(
      @AuthenticationPrincipal Jwt jwt,
      @PathVariable String productId,
      @PathVariable String imageId) {
    var image =
        images.download(
            subject(jwt), AdminCatalogRequests.id(productId), AdminCatalogRequests.id(imageId));
    return ResponseEntity.ok()
        .header("Cache-Control", "private, no-store")
        .header("X-Content-Type-Options", "nosniff")
        .header("Cross-Origin-Resource-Policy", "same-origin")
        .contentType(MediaType.parseMediaType(image.contentType()))
        .body(image.bytes());
  }

  private static long version(String value) {
    try {
      if (value == null || !value.matches("0|[1-9][0-9]{0,18}"))
        throw CatalogImageException.invalid();
      return Long.parseLong(value);
    } catch (NumberFormatException e) {
      throw CatalogImageException.invalid();
    }
  }

  private static UUID subject(Jwt jwt) {
    try {
      return UUID.fromString(jwt.getSubject());
    } catch (RuntimeException e) {
      throw new CatalogImageException(403, "ADMIN_CATALOG_FORBIDDEN");
    }
  }
}

package com.santotofood.adapter.in.web;

import com.santotofood.adapter.in.web.dto.AdminCatalogRequests;
import com.santotofood.adapter.in.web.dto.AdminCatalogResponse;
import com.santotofood.application.port.in.GetAdminCatalogUseCase;
import com.santotofood.application.port.in.ManageAdminCatalogUseCase;
import jakarta.servlet.http.HttpServletRequest;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/admin/catalog")
@PreAuthorize("isAuthenticated()")
public class AdminCatalogController {
  private final GetAdminCatalogUseCase catalog;
  private final ManageAdminCatalogUseCase commands;

  public AdminCatalogController(
      GetAdminCatalogUseCase catalog, ManageAdminCatalogUseCase commands) {
    this.catalog = catalog;
    this.commands = commands;
  }

  @GetMapping
  public ResponseEntity<AdminCatalogResponse> catalog(@AuthenticationPrincipal Jwt jwt) {
    return ResponseEntity.ok()
        .cacheControl(CacheControl.noStore())
        .body(AdminCatalogResponse.from(catalog.getAdminCatalog(subject(jwt))));
  }

  @PostMapping
  public ResponseEntity<AdminCatalogResponse.Product> create(
      @AuthenticationPrincipal Jwt jwt, HttpServletRequest request) {
    var form = AdminCatalogRequests.create(request);
    return ResponseEntity.status(201)
        .cacheControl(CacheControl.noStore())
        .body(AdminCatalogResponse.product(commands.create(subject(jwt), form)));
  }

  @PatchMapping("/{productId}")
  public ResponseEntity<AdminCatalogResponse.Product> edit(
      @AuthenticationPrincipal Jwt jwt,
      @PathVariable String productId,
      HttpServletRequest request) {
    var body = AdminCatalogRequests.edit(request);
    return ResponseEntity.ok()
        .cacheControl(CacheControl.noStore())
        .body(
            AdminCatalogResponse.product(
                commands.edit(
                    subject(jwt),
                    AdminCatalogRequests.id(productId),
                    body.expectedVersion(),
                    body.form())));
  }

  @PatchMapping("/{productId}/status")
  public ResponseEntity<AdminCatalogResponse.Product> status(
      @AuthenticationPrincipal Jwt jwt,
      @PathVariable String productId,
      HttpServletRequest request) {
    var body = AdminCatalogRequests.status(request);
    return ResponseEntity.ok()
        .cacheControl(CacheControl.noStore())
        .body(
            AdminCatalogResponse.product(
                commands.status(
                    subject(jwt),
                    AdminCatalogRequests.id(productId),
                    body.expectedVersion(),
                    body.active())));
  }

  private UUID subject(Jwt jwt) {
    UUID user;
    try {
      if (jwt == null || jwt.getSubject() == null) throw new IllegalArgumentException();
      user = UUID.fromString(jwt.getSubject());
    } catch (IllegalArgumentException exception) {
      throw new AccessDeniedException("Admin identity unavailable");
    }
    return user;
  }
}

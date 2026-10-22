package com.santotofood.adapter.in.web;

import com.santotofood.adapter.in.web.dto.AdminCatalogResponse;
import com.santotofood.application.port.in.GetAdminCatalogUseCase;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/admin/catalog")
@PreAuthorize("isAuthenticated()")
public class AdminCatalogController {
  private final GetAdminCatalogUseCase catalog;

  public AdminCatalogController(GetAdminCatalogUseCase catalog) {
    this.catalog = catalog;
  }

  @GetMapping
  public ResponseEntity<AdminCatalogResponse> catalog(@AuthenticationPrincipal Jwt jwt) {
    UUID user;
    try {
      if (jwt == null || jwt.getSubject() == null) throw new IllegalArgumentException();
      user = UUID.fromString(jwt.getSubject());
    } catch (IllegalArgumentException exception) {
      throw new AccessDeniedException("Admin identity unavailable");
    }
    // No caller-supplied selectors: only the verified JWT subject enters the use case.
    return ResponseEntity.ok()
        .cacheControl(CacheControl.noStore())
        .body(AdminCatalogResponse.from(catalog.getAdminCatalog(user)));
  }
}

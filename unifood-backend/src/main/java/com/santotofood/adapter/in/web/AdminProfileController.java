package com.santotofood.adapter.in.web;

import com.santotofood.adapter.in.web.dto.AdminProfileResponse;
import com.santotofood.application.port.in.GetAdminProfileUseCase;
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
@RequestMapping("/api/admin/profile")
@PreAuthorize("isAuthenticated()")
public class AdminProfileController {
  private final GetAdminProfileUseCase profiles;

  public AdminProfileController(GetAdminProfileUseCase profiles) {
    this.profiles = profiles;
  }

  @GetMapping
  public ResponseEntity<AdminProfileResponse> profile(@AuthenticationPrincipal Jwt jwt) {
    UUID user;
    try {
      if (jwt == null || jwt.getSubject() == null) throw new IllegalArgumentException();
      user = UUID.fromString(jwt.getSubject());
    } catch (IllegalArgumentException exception) {
      throw new AccessDeniedException("Admin identity unavailable");
    }
    return ResponseEntity.ok()
        .cacheControl(CacheControl.noStore())
        .body(AdminProfileResponse.from(profiles.getAdminProfile(user)));
  }
}

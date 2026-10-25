package com.santotofood.adapter.in.web;

import com.santotofood.adapter.in.web.dto.AdminDashboardResponse;
import com.santotofood.application.model.AdminDashboardRequest;
import com.santotofood.application.port.in.GetAdminDashboardUseCase;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.util.MultiValueMap;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/admin/dashboard")
@PreAuthorize("isAuthenticated()")
public class AdminDashboardController {
  private final GetAdminDashboardUseCase dashboard;

  public AdminDashboardController(GetAdminDashboardUseCase dashboard) {
    this.dashboard = dashboard;
  }

  @GetMapping
  public ResponseEntity<AdminDashboardResponse> get(
      @AuthenticationPrincipal Jwt jwt, @RequestParam MultiValueMap<String, String> parameters) {
    UUID subject;
    try {
      subject = UUID.fromString(jwt.getSubject());
    } catch (IllegalArgumentException | NullPointerException exception) {
      throw new AccessDeniedException("Dashboard identity unavailable");
    }
    return ResponseEntity.ok()
        .cacheControl(CacheControl.noStore())
        .body(
            AdminDashboardResponse.from(
                dashboard.getDashboard(subject, AdminDashboardRequest.parse(parameters))));
  }
}

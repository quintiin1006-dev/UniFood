package com.santotofood.adapter.in.web;

import com.santotofood.adapter.in.web.dto.SuperAdminCafeteriasResponse;
import com.santotofood.application.port.in.ListSuperAdminCafeteriasUseCase;
import com.santotofood.config.OrderAuthorization;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/super-admin/cafeterias")
public class SuperAdminCafeteriaController {
  private final OrderAuthorization authorization;
  private final ListSuperAdminCafeteriasUseCase cafeterias;

  public SuperAdminCafeteriaController(
      OrderAuthorization authorization, ListSuperAdminCafeteriasUseCase cafeterias) {
    this.authorization = authorization;
    this.cafeterias = cafeterias;
  }

  @GetMapping
  @PreAuthorize("@orderAuthorization.superAdmin(authentication)")
  public ResponseEntity<SuperAdminCafeteriasResponse> list(Authentication authentication) {
    var user =
        authorization
            .authenticatedUser(authentication)
            .orElseThrow(() -> new AccessDeniedException("Super admin identity unavailable"));
    return ResponseEntity.ok()
        .cacheControl(CacheControl.noStore())
        .body(SuperAdminCafeteriasResponse.from(cafeterias.listCafeterias(user)));
  }
}

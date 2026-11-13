package com.santotofood.adapter.in.web;

import com.santotofood.adapter.in.web.dto.CafeteriaSettingsAuditResponse;
import com.santotofood.adapter.in.web.dto.SuperAdminCafeteriaRequests;
import com.santotofood.adapter.in.web.dto.SuperAdminCafeteriasResponse;
import com.santotofood.application.port.in.ChangeCafeteriaBillingUseCase;
import com.santotofood.application.port.in.ChangeCafeteriaVisibilityUseCase;
import com.santotofood.application.port.in.ListCafeteriaSettingsAuditUseCase;
import com.santotofood.application.port.in.ListSuperAdminCafeteriasUseCase;
import com.santotofood.config.OrderAuthorization;
import jakarta.servlet.http.HttpServletRequest;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/super-admin/cafeterias")
@PreAuthorize("@orderAuthorization.superAdmin(authentication)")
public class SuperAdminCafeteriaController {
  private final OrderAuthorization authorization;
  private final ListSuperAdminCafeteriasUseCase cafeterias;
  private final ChangeCafeteriaVisibilityUseCase visibility;
  private final ChangeCafeteriaBillingUseCase billing;
  private final ListCafeteriaSettingsAuditUseCase audit;

  public SuperAdminCafeteriaController(
      OrderAuthorization authorization,
      ListSuperAdminCafeteriasUseCase cafeterias,
      ChangeCafeteriaVisibilityUseCase visibility,
      ChangeCafeteriaBillingUseCase billing,
      ListCafeteriaSettingsAuditUseCase audit) {
    this.authorization = authorization;
    this.cafeterias = cafeterias;
    this.visibility = visibility;
    this.billing = billing;
    this.audit = audit;
  }

  private UUID user(Authentication authentication) {
    return authorization
        .authenticatedUser(authentication)
        .orElseThrow(() -> new AccessDeniedException("Super admin identity unavailable"));
  }

  @GetMapping
  public ResponseEntity<SuperAdminCafeteriasResponse> list(Authentication authentication) {
    return ResponseEntity.ok()
        .cacheControl(CacheControl.noStore())
        .body(SuperAdminCafeteriasResponse.from(cafeterias.listCafeterias(user(authentication))));
  }

  @PatchMapping("/{cafeteriaId}/visibility")
  public ResponseEntity<SuperAdminCafeteriasResponse.Cafeteria> visibility(
      Authentication authentication, @PathVariable String cafeteriaId, HttpServletRequest request) {
    UUID id = SuperAdminCafeteriaRequests.id(cafeteriaId);
    var body = SuperAdminCafeteriaRequests.visibility(request);
    return ResponseEntity.ok()
        .cacheControl(CacheControl.noStore())
        .body(
            SuperAdminCafeteriasResponse.cafeteria(
                visibility.changeVisibility(
                    user(authentication), id, body.visible(), body.expectedVisible())));
  }

  @PutMapping("/{cafeteriaId}/billing")
  public ResponseEntity<SuperAdminCafeteriasResponse.Cafeteria> billing(
      Authentication authentication, @PathVariable String cafeteriaId, HttpServletRequest request) {
    UUID id = SuperAdminCafeteriaRequests.id(cafeteriaId);
    var body = SuperAdminCafeteriaRequests.billing(request);
    return ResponseEntity.ok()
        .cacheControl(CacheControl.noStore())
        .body(
            SuperAdminCafeteriasResponse.cafeteria(
                billing.changeBilling(
                    user(authentication), id, body.billing(), body.expectedVersion())));
  }

  @GetMapping("/{cafeteriaId}/audit")
  public ResponseEntity<CafeteriaSettingsAuditResponse> audit(
      Authentication authentication,
      @PathVariable String cafeteriaId,
      @RequestParam(name = "limit", required = false) String limit) {
    UUID id = SuperAdminCafeteriaRequests.id(cafeteriaId);
    int size = SuperAdminCafeteriaRequests.limit(limit);
    return ResponseEntity.ok()
        .cacheControl(CacheControl.noStore())
        .body(CafeteriaSettingsAuditResponse.from(audit.listAudit(user(authentication), id, size)));
  }
}

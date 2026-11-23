package com.santotofood.adapter.in.web;

import com.santotofood.adapter.in.web.dto.ServiceFeeRequests;
import com.santotofood.adapter.in.web.dto.ServiceFeeResponses;
import com.santotofood.application.port.in.ManageServiceFeeUseCase;
import com.santotofood.config.OrderAuthorization;
import jakarta.servlet.http.HttpServletRequest;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** SUPER_ADMIN service fee: values, monthly settlements, CSV and history (033). All no-store. */
@RestController
@RequestMapping("/api/super-admin/service-fee")
@PreAuthorize("@orderAuthorization.superAdmin(authentication)")
public class SuperAdminServiceFeeController {
  private final OrderAuthorization authorization;
  private final ManageServiceFeeUseCase fees;

  public SuperAdminServiceFeeController(
      OrderAuthorization authorization, ManageServiceFeeUseCase fees) {
    this.authorization = authorization;
    this.fees = fees;
  }

  private UUID user(Authentication authentication) {
    return authorization
        .authenticatedUser(authentication)
        .orElseThrow(() -> new AccessDeniedException("Super admin identity unavailable"));
  }

  private static <T> ResponseEntity<T> ok(T body) {
    return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(body);
  }

  @GetMapping
  public ResponseEntity<ServiceFeeResponses.Overview> overview(Authentication authentication) {
    return ok(ServiceFeeResponses.overview(fees.overview(user(authentication))));
  }

  @PutMapping("/general")
  public ResponseEntity<ServiceFeeResponses.Overview> general(
      Authentication authentication, HttpServletRequest request) {
    var body = ServiceFeeRequests.fee(request, false);
    return ok(
        ServiceFeeResponses.overview(
            fees.changeGeneralFee(user(authentication), body.feeCop(), body.expectedVersion())));
  }

  @PutMapping("/cafeterias/{cafeteriaId}")
  public ResponseEntity<ServiceFeeResponses.Overview> cafeteria(
      Authentication authentication, @PathVariable String cafeteriaId, HttpServletRequest request) {
    UUID id = ServiceFeeRequests.id(cafeteriaId);
    var body = ServiceFeeRequests.fee(request, true);
    return ok(
        ServiceFeeResponses.overview(
            fees.changeCafeteriaFee(
                user(authentication), id, body.feeCop(), body.expectedVersion())));
  }

  @GetMapping("/audit")
  public ResponseEntity<ServiceFeeResponses.Audit> audit(
      Authentication authentication, @RequestParam(name = "limit", required = false) String limit) {
    int size = ServiceFeeRequests.limit(limit);
    return ok(ServiceFeeResponses.audit(fees.audit(user(authentication), size)));
  }

  @GetMapping("/settlements")
  public ResponseEntity<ServiceFeeResponses.Month> month(
      Authentication authentication, @RequestParam(name = "month", required = false) String month) {
    var period = ServiceFeeRequests.month(month);
    return ok(ServiceFeeResponses.month(fees.month(user(authentication), period)));
  }

  @GetMapping("/settlements.csv")
  public ResponseEntity<byte[]> csv(
      Authentication authentication, @RequestParam(name = "month", required = false) String month) {
    var period = ServiceFeeRequests.month(month);
    // A BOM so spreadsheet programs read the accents as UTF-8.
    var text = "﻿" + ServiceFeeResponses.csv(fees.month(user(authentication), period));
    return ResponseEntity.ok()
        .cacheControl(CacheControl.noStore())
        .contentType(new MediaType("text", "csv", StandardCharsets.UTF_8))
        .header(
            HttpHeaders.CONTENT_DISPOSITION,
            ContentDisposition.attachment()
                .filename("cargo-por-servicio-" + period + ".csv")
                .build()
                .toString())
        .header("X-Content-Type-Options", "nosniff")
        .body(text.getBytes(StandardCharsets.UTF_8));
  }

  @PostMapping("/settlements/{cafeteriaId}/{month}/close")
  public ResponseEntity<ServiceFeeResponses.Row> close(
      Authentication authentication, @PathVariable String cafeteriaId, @PathVariable String month) {
    UUID id = ServiceFeeRequests.id(cafeteriaId);
    var period = ServiceFeeRequests.month(month);
    return ok(ServiceFeeResponses.row(fees.closeMonth(user(authentication), id, period)));
  }

  @PostMapping("/settlements/{cafeteriaId}/{month}/paid")
  public ResponseEntity<ServiceFeeResponses.Row> paid(
      Authentication authentication,
      @PathVariable String cafeteriaId,
      @PathVariable String month,
      HttpServletRequest request) {
    UUID id = ServiceFeeRequests.id(cafeteriaId);
    var period = ServiceFeeRequests.month(month);
    var note = ServiceFeeRequests.note(request);
    return ok(ServiceFeeResponses.row(fees.markPaid(user(authentication), id, period, note)));
  }
}

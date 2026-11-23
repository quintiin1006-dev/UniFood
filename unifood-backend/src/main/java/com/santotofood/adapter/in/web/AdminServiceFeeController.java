package com.santotofood.adapter.in.web;

import com.santotofood.adapter.in.web.dto.ServiceFeeResponses;
import com.santotofood.application.port.in.GetOwnServiceFeeUseCase;
import com.santotofood.config.OrderAuthorization;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * ADMIN, read only: the service fee of their own cafeteria (033). The cafeteria comes from the
 * database, never from the request, so another cafeteria cannot even be named.
 */
@RestController
@RequestMapping("/api/admin/service-fee")
@PreAuthorize("isAuthenticated()")
public class AdminServiceFeeController {
  private final OrderAuthorization authorization;
  private final GetOwnServiceFeeUseCase fees;

  public AdminServiceFeeController(OrderAuthorization authorization, GetOwnServiceFeeUseCase fees) {
    this.authorization = authorization;
    this.fees = fees;
  }

  @GetMapping
  public ResponseEntity<ServiceFeeResponses.Statement> statement(Authentication authentication) {
    UUID user =
        authorization
            .authenticatedUser(authentication)
            .orElseThrow(() -> new AccessDeniedException("Admin identity unavailable"));
    return ResponseEntity.ok()
        .cacheControl(CacheControl.noStore())
        .body(ServiceFeeResponses.statement(fees.statement(user)));
  }
}

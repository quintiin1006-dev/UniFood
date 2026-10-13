package com.santotofood.adapter.in.web;

import com.santotofood.adapter.in.web.dto.ClientProfileResponse;
import com.santotofood.application.port.in.GetClientProfileUseCase;
import com.santotofood.config.OrderAuthorization;
import lombok.RequiredArgsConstructor;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/me/profile")
@RequiredArgsConstructor
public class ClientProfileController {
  private final GetClientProfileUseCase profiles;
  private final OrderAuthorization authorization;

  @GetMapping
  @PreAuthorize("@orderAuthorization.client(authentication)")
  public ResponseEntity<ClientProfileResponse> profile(Authentication authentication) {
    var userId =
        authorization
            .authenticatedUser(authentication)
            .orElseThrow(() -> new AccessDeniedException("Client identity unavailable"));
    var profile = profiles.getClientProfile(userId);
    return ResponseEntity.ok()
        .cacheControl(CacheControl.noStore())
        .body(
            new ClientProfileResponse(profile.document(), profile.phone(), profile.institution()));
  }
}

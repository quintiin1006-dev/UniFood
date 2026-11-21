package com.santotofood.adapter.in.web;

import com.santotofood.adapter.in.web.dto.ClientDailyMenuResponse;
import com.santotofood.application.port.in.GetClientDailyMenuUseCase;
import com.santotofood.config.OrderAuthorization;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** CLIENT read of today's daily menu (docs/propuesta-menu-dinamico.md, sections 3.1 and 3.2). */
@RestController
@RequestMapping("/api/me")
@RequiredArgsConstructor
public class ClientDailyMenuController {
  private final GetClientDailyMenuUseCase menus;
  private final OrderAuthorization authorization;

  @GetMapping("/daily-menu")
  @PreAuthorize("@orderAuthorization.client(authentication)")
  public ResponseEntity<ClientDailyMenuResponse> dailyMenu(
      Authentication authentication, @RequestParam UUID cafeteriaId) {
    var user =
        authorization
            .authenticatedUser(authentication)
            .orElseThrow(() -> new AccessDeniedException("Client identity unavailable"));
    return ResponseEntity.ok()
        .cacheControl(CacheControl.noStore())
        .body(ClientDailyMenuResponse.from(menus.getClientDailyMenu(user, cafeteriaId)));
  }
}

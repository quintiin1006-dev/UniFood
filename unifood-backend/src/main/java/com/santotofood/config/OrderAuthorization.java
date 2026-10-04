package com.santotofood.config;

import com.santotofood.application.service.OrderAuthorizationService;
import java.util.Optional;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.stereotype.Component;

/** Spring Security entry adapter; policy and database access live behind application ports. */
@Component("orderAuthorization")
@RequiredArgsConstructor
public class OrderAuthorization {
  private final OrderAuthorizationService authorization;

  public boolean cafeteria(Authentication authentication, UUID cafeteriaId) {
    return authenticatedUser(authentication)
        .map(userId -> authorization.cafeteria(userId, cafeteriaId))
        .orElse(false);
  }

  public Optional<UUID> workerCafeteria(Authentication authentication) {
    return authenticatedUser(authentication).flatMap(authorization::workerCafeteria);
  }

  private Optional<UUID> authenticatedUser(Authentication authentication) {
    if (!(authentication instanceof JwtAuthenticationToken token)) return Optional.empty();
    if (token.getToken().getSubject() == null) return Optional.empty();
    try {
      return Optional.of(UUID.fromString(token.getToken().getSubject()));
    } catch (IllegalArgumentException exception) {
      return Optional.empty();
    }
  }

  public boolean clientOrder(Authentication authentication, UUID orderId) {
    return authenticatedUser(authentication)
        .map(userId -> authorization.clientOrder(userId, orderId))
        .orElse(false);
  }

  public boolean order(Authentication authentication, UUID orderId) {
    return authenticatedUser(authentication)
        .map(userId -> authorization.order(userId, orderId))
        .orElse(false);
  }
}

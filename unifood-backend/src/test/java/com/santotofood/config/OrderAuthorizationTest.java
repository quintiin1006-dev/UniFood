package com.santotofood.config;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.santotofood.application.service.OrderAuthorizationService;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullAndEmptySource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;

class OrderAuthorizationTest {
  private final OrderAuthorizationService service = mock(OrderAuthorizationService.class);
  private final OrderAuthorization adapter = new OrderAuthorization(service);
  private final UUID cafeteriaId = UUID.randomUUID();
  private final UUID orderId = UUID.randomUUID();

  private Authentication token(String subject, String claimedRole) {
    var builder =
        Jwt.withTokenValue("fixture-token")
            .header("alg", "RS256")
            .claim("user_metadata", Map.of("role", claimedRole));
    if (subject != null) builder.subject(subject);
    return new JwtAuthenticationToken(builder.build());
  }

  @ParameterizedTest
  @NullAndEmptySource
  @ValueSource(strings = {"invalid", "not-a-uuid"})
  void absentOrInvalidSubjectIsDeniedWithoutCallingApplication(String subject) {
    Authentication authentication = token(subject, "WORKER");
    assertTrue(adapter.workerCafeteria(authentication).isEmpty());
    assertFalse(adapter.cafeteria(authentication, cafeteriaId));
    assertFalse(adapter.order(authentication, orderId));
    verifyNoInteractions(service);
  }

  @Test
  void unsupportedOrAbsentAuthenticationIsDenied() {
    for (Authentication authentication : new Authentication[] {null, mock(Authentication.class)}) {
      assertTrue(adapter.workerCafeteria(authentication).isEmpty());
      assertFalse(adapter.cafeteria(authentication, cafeteriaId));
      assertFalse(adapter.order(authentication, orderId));
    }
    verifyNoInteractions(service);
  }

  @ParameterizedTest
  @ValueSource(strings = {"CLIENT", "WORKER", "ADMIN", "SUPER_ADMIN"})
  void onlyTheSubjectIsPassedToApplicationRegardlessOfClaimedRole(String claimedRole) {
    UUID userId = UUID.randomUUID();
    Authentication authentication = token(userId.toString(), claimedRole);
    when(service.workerCafeteria(userId)).thenReturn(Optional.of(cafeteriaId));
    when(service.cafeteria(userId, cafeteriaId)).thenReturn(true);
    when(service.order(userId, orderId)).thenReturn(true);
    assertEquals(Optional.of(cafeteriaId), adapter.workerCafeteria(authentication));
    assertTrue(adapter.cafeteria(authentication, cafeteriaId));
    assertTrue(adapter.order(authentication, orderId));
    verify(service).workerCafeteria(userId);
    verify(service).cafeteria(userId, cafeteriaId);
    verify(service).order(userId, orderId);
    verifyNoMoreInteractions(service);
  }
}

package com.santotofood.config;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.santotofood.adapter.in.web.WorkerProfileController;
import com.santotofood.application.model.WorkerProfileDetails;
import com.santotofood.application.port.in.GetWorkerProfileUseCase;
import com.santotofood.application.service.OrderAuthorizationService;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.authentication.TestingAuthenticationToken;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;

class WorkerProfileAuthorizationTest {
  final GetWorkerProfileUseCase profiles = mock(GetWorkerProfileUseCase.class);
  final WorkerProfileController controller =
      new WorkerProfileController(
          new OrderAuthorization(mock(OrderAuthorizationService.class)), profiles);

  @Test
  void onlyTheVerifiedJwtSubjectIsPassedToTheBusinessPolicy() {
    UUID user = UUID.randomUUID();
    var token =
        new JwtAuthenticationToken(
            Jwt.withTokenValue("verified-test-token")
                .header("alg", "test")
                .subject(user.toString())
                .claim("userId", UUID.randomUUID().toString())
                .claim("role", "ADMIN")
                .claim("cafeteriaId", UUID.randomUUID().toString())
                .build());
    when(profiles.getWorkerProfile(user))
        .thenReturn(new WorkerProfileDetails("Cafe", false, "Site", "Institution"));
    var result = controller.profile(token);
    assertEquals("WORKER", result.getBody().role());
    assertFalse(result.getBody().cafeteria().active());
    assertEquals("no-store", result.getHeaders().getCacheControl());
    verify(profiles).getWorkerProfile(user);
    verifyNoMoreInteractions(profiles);
  }

  @ParameterizedTest
  @ValueSource(strings = {"", "not-a-uuid"})
  void malformedSubjectsNeverReachTheBusinessQuery(String subject) {
    var token =
        new JwtAuthenticationToken(
            Jwt.withTokenValue("verified-test-token")
                .header("alg", "test")
                .subject(subject)
                .build());
    assertThrows(AccessDeniedException.class, () -> controller.profile(token));
    verifyNoInteractions(profiles);
  }

  @Test
  void anAuthenticatedPrincipalWithoutAVerifiedJwtCannotSupplyAnIdentity() {
    assertThrows(
        AccessDeniedException.class,
        () -> controller.profile(new TestingAuthenticationToken("untrusted", "unused", "WORKER")));
    verifyNoInteractions(profiles);
  }
}

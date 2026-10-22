package com.santotofood.config;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.santotofood.adapter.in.web.AdminProfileController;
import com.santotofood.application.model.AdminProfileDetails;
import com.santotofood.application.port.in.GetAdminProfileUseCase;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.oauth2.jwt.Jwt;

class AdminProfileAuthorizationTest {
  final GetAdminProfileUseCase profiles = mock(GetAdminProfileUseCase.class);
  final AdminProfileController controller = new AdminProfileController(profiles);

  @Test
  void onlyTheVerifiedJwtSubjectIsPassedToTheBusinessPolicy() {
    UUID user = UUID.randomUUID();
    var token =
        Jwt.withTokenValue("verified-test-token")
            .header("alg", "test")
            .subject(user.toString())
            .claim("userId", UUID.randomUUID().toString())
            .claim("role", "WORKER")
            .claim("cafeteriaId", UUID.randomUUID().toString())
            .build();
    when(profiles.getAdminProfile(user))
        .thenReturn(new AdminProfileDetails("Cafe", false, "Site", "Institution"));
    var result = controller.profile(token);
    assertEquals("ADMIN", result.getBody().role());
    assertFalse(result.getBody().cafeteria().active());
    assertEquals("no-store", result.getHeaders().getCacheControl());
    verify(profiles).getAdminProfile(user);
    verifyNoMoreInteractions(profiles);
  }

  @ParameterizedTest
  @ValueSource(strings = {"", "not-a-uuid"})
  void malformedSubjectsNeverReachTheBusinessQuery(String subject) {
    var token =
        Jwt.withTokenValue("verified-test-token").header("alg", "test").subject(subject).build();
    assertThrows(AccessDeniedException.class, () -> controller.profile(token));
    verifyNoInteractions(profiles);
  }

  @Test
  void anAuthenticatedPrincipalWithoutAVerifiedJwtCannotSupplyAnIdentity() {
    assertThrows(AccessDeniedException.class, () -> controller.profile(null));
    verifyNoInteractions(profiles);
  }
}

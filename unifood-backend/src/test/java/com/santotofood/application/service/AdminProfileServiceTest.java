package com.santotofood.application.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.santotofood.application.exception.AdminProfileForbiddenException;
import com.santotofood.application.model.AdminProfileDetails;
import com.santotofood.application.model.UserAuthorization;
import com.santotofood.application.port.out.AdminProfileQueryPort;
import com.santotofood.application.port.out.AuthorizationQueryPort;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.dao.DataAccessResourceFailureException;

class AdminProfileServiceTest {
  final UUID user = UUID.randomUUID(), cafe = UUID.randomUUID();
  final AuthorizationQueryPort facts = mock(AuthorizationQueryPort.class);
  final AdminProfileQueryPort profiles = mock(AdminProfileQueryPort.class);
  final AdminProfileService service = new AdminProfileService(facts, profiles);

  @ParameterizedTest
  @ValueSource(
      strings = {
        "NO_USER",
        "INACTIVE",
        "NO_ROLE",
        "CLIENT",
        "WORKER",
        "SUPER_ADMIN",
        "UNKNOWN_ROLE",
        "ADMIN_CLIENT",
        "ADMIN_WORKER",
        "ADMIN_SUPER_ADMIN",
        "NO_ASSIGNMENT",
        "MULTIPLE_ASSIGNMENTS"
      })
  void invalidAuthorizationCannotReadAnyProfile(String scenario) {
    Set<String> roles =
        switch (scenario) {
          case "NO_ROLE" -> Set.of();
          case "CLIENT", "WORKER", "SUPER_ADMIN" -> Set.of(scenario);
          case "UNKNOWN_ROLE" -> Set.of("UNKNOWN");
          case "ADMIN_CLIENT" -> Set.of("ADMIN", "CLIENT");
          case "ADMIN_WORKER" -> Set.of("ADMIN", "WORKER");
          case "ADMIN_SUPER_ADMIN" -> Set.of("ADMIN", "SUPER_ADMIN");
          default -> Set.of("ADMIN");
        };
    List<UUID> assignments =
        switch (scenario) {
          case "NO_ASSIGNMENT" -> List.of();
          case "MULTIPLE_ASSIGNMENTS" -> List.of(cafe, UUID.randomUUID());
          default -> List.of(cafe);
        };
    when(facts.findUserAuthorization(user))
        .thenReturn(
            scenario.equals("NO_USER")
                ? Optional.empty()
                : Optional.of(
                    new UserAuthorization(!scenario.equals("INACTIVE"), roles, assignments)));
    assertThrows(AdminProfileForbiddenException.class, () -> service.getAdminProfile(user));
    verifyNoInteractions(profiles);
  }

  @ParameterizedTest
  @ValueSource(booleans = {true, false})
  void onlyTheAuthorizedUserAndCafeteriaReachTheReadPortRegardlessOfCafeteriaActivity(
      boolean active) {
    when(facts.findUserAuthorization(user))
        .thenReturn(Optional.of(new UserAuthorization(true, Set.of("ADMIN"), List.of(cafe))));
    var profile =
        new AdminProfileDetails(
            "Assigned cafeteria", active, "Assigned site", "Assigned institution");
    when(profiles.findByUserAndCafeteria(user, cafe)).thenReturn(Optional.of(profile));
    assertSame(profile, service.getAdminProfile(user));
    verify(profiles).findByUserAndCafeteria(user, cafe);
    verifyNoMoreInteractions(profiles);
  }

  @Test
  void aMissingAssignmentProjectionIsForbiddenInsteadOfAnOptionalProfile404() {
    when(facts.findUserAuthorization(user))
        .thenReturn(Optional.of(new UserAuthorization(true, Set.of("ADMIN"), List.of(cafe))));
    when(profiles.findByUserAndCafeteria(user, cafe)).thenReturn(Optional.empty());
    assertThrows(AdminProfileForbiddenException.class, () -> service.getAdminProfile(user));
  }

  @Test
  void authorizationFailureCannotFallBackToAProfileOrCachedDecision() {
    when(facts.findUserAuthorization(user))
        .thenThrow(new DataAccessResourceFailureException("PRIVATE"));
    assertThrows(DataAccessResourceFailureException.class, () -> service.getAdminProfile(user));
    verifyNoInteractions(profiles);
  }
}

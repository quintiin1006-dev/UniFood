package com.santotofood.application.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.santotofood.application.exception.WorkerProfileForbiddenException;
import com.santotofood.application.model.UserAuthorization;
import com.santotofood.application.model.WorkerProfileDetails;
import com.santotofood.application.port.out.AuthorizationQueryPort;
import com.santotofood.application.port.out.WorkerProfileQueryPort;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.dao.DataAccessResourceFailureException;

class WorkerProfileServiceTest {
  final UUID user = UUID.randomUUID(), cafe = UUID.randomUUID();
  final AuthorizationQueryPort facts = mock(AuthorizationQueryPort.class);
  final WorkerProfileQueryPort profiles = mock(WorkerProfileQueryPort.class);
  final WorkerProfileService service =
      new WorkerProfileService(new OrderAuthorizationService(facts), profiles);

  @ParameterizedTest
  @ValueSource(
      strings = {
        "NO_USER",
        "INACTIVE",
        "NO_ROLE",
        "CLIENT",
        "ADMIN",
        "SUPER_ADMIN",
        "UNKNOWN_ROLE",
        "WORKER_CLIENT",
        "WORKER_ADMIN",
        "WORKER_SUPER_ADMIN",
        "NO_ASSIGNMENT",
        "MULTIPLE_ASSIGNMENTS"
      })
  void invalidAuthorizationCannotReadAnyProfile(String scenario) {
    Set<String> roles =
        switch (scenario) {
          case "NO_ROLE" -> Set.of();
          case "CLIENT", "ADMIN", "SUPER_ADMIN" -> Set.of(scenario);
          case "UNKNOWN_ROLE" -> Set.of("UNKNOWN");
          case "WORKER_CLIENT" -> Set.of("WORKER", "CLIENT");
          case "WORKER_ADMIN" -> Set.of("WORKER", "ADMIN");
          case "WORKER_SUPER_ADMIN" -> Set.of("WORKER", "SUPER_ADMIN");
          default -> Set.of("WORKER");
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
    assertThrows(WorkerProfileForbiddenException.class, () -> service.getWorkerProfile(user));
    verifyNoInteractions(profiles);
  }

  @ParameterizedTest
  @ValueSource(booleans = {true, false})
  void onlyTheAuthorizedUserAndCafeteriaReachTheReadPortRegardlessOfCafeteriaActivity(
      boolean active) {
    when(facts.findUserAuthorization(user))
        .thenReturn(Optional.of(new UserAuthorization(true, Set.of("WORKER"), List.of(cafe))));
    var profile =
        new WorkerProfileDetails(
            "Assigned cafeteria", active, "Assigned site", "Assigned institution");
    when(profiles.findByUserAndCafeteria(user, cafe)).thenReturn(Optional.of(profile));
    assertSame(profile, service.getWorkerProfile(user));
    verify(profiles).findByUserAndCafeteria(user, cafe);
    verifyNoMoreInteractions(profiles);
  }

  @Test
  void aMissingAssignmentProjectionIsForbiddenInsteadOfAnOptionalProfile404() {
    when(facts.findUserAuthorization(user))
        .thenReturn(Optional.of(new UserAuthorization(true, Set.of("WORKER"), List.of(cafe))));
    when(profiles.findByUserAndCafeteria(user, cafe)).thenReturn(Optional.empty());
    assertThrows(WorkerProfileForbiddenException.class, () -> service.getWorkerProfile(user));
  }

  @Test
  void authorizationFailureCannotFallBackToAProfileOrCachedDecision() {
    when(facts.findUserAuthorization(user))
        .thenThrow(new DataAccessResourceFailureException("PRIVATE"));
    assertThrows(DataAccessResourceFailureException.class, () -> service.getWorkerProfile(user));
    verifyNoInteractions(profiles);
  }
}

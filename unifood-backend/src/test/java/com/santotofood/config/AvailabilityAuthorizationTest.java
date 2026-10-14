package com.santotofood.config;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.santotofood.adapter.in.web.AvailabilityController;
import com.santotofood.application.model.UserAuthorization;
import com.santotofood.application.port.in.GetTodayAvailabilityUseCase;
import com.santotofood.application.port.in.SetDailyAvailabilityUseCase;
import com.santotofood.application.port.out.AuthorizationQueryPort;
import com.santotofood.application.service.OrderAuthorizationService;
import java.time.LocalDate;
import java.util.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;

/**
 * Defensive invalid profiles cannot exist after 009 but must still be denied by the shared policy.
 */
class AvailabilityAuthorizationTest {
  @ParameterizedTest
  @ValueSource(
      strings = {"NO_ASSIGNMENT", "MULTIPLE_ASSIGNMENTS", "MULTIPLE_ROLES", "NO_ROLE", "INACTIVE"})
  void invalidWorkerFactsCannotReachAnyAvailabilityUseCase(String scenario) {
    UUID user = UUID.randomUUID(), cafe = UUID.randomUUID();
    var queries = mock(AuthorizationQueryPort.class);
    Set<String> roles =
        switch (scenario) {
          case "MULTIPLE_ROLES" -> Set.of("WORKER", "ADMIN");
          case "NO_ROLE" -> Set.of();
          default -> Set.of("WORKER");
        };
    List<UUID> assignments =
        switch (scenario) {
          case "NO_ASSIGNMENT" -> List.of();
          case "MULTIPLE_ASSIGNMENTS" -> List.of(cafe, UUID.randomUUID());
          default -> List.of(cafe);
        };
    when(queries.findUserAuthorization(user))
        .thenReturn(
            Optional.of(new UserAuthorization(!scenario.equals("INACTIVE"), roles, assignments)));
    var read = mock(GetTodayAvailabilityUseCase.class);
    var write = mock(SetDailyAvailabilityUseCase.class);
    var controller =
        new AvailabilityController(
            new OrderAuthorization(new OrderAuthorizationService(queries)), read, write);
    var auth =
        new JwtAuthenticationToken(
            Jwt.withTokenValue("verified")
                .header("alg", "test")
                .subject(user.toString())
                .claim("role", "WORKER")
                .build(),
            List.of());
    assertThrows(AccessDeniedException.class, () -> controller.today(auth));
    assertThrows(
        AccessDeniedException.class,
        () ->
            controller.item(
                auth,
                UUID.randomUUID(),
                LocalDate.of(2026, 10, 13),
                new AvailabilityController.ItemRequest(true)));
    assertThrows(
        AccessDeniedException.class,
        () ->
            controller.cafeteriaState(
                auth,
                LocalDate.of(2026, 10, 13),
                new AvailabilityController.CafeteriaRequest(true)));
    verifyNoInteractions(read, write);
  }
}

package com.santotofood.config;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.santotofood.adapter.in.web.WorkerHistoryController;
import com.santotofood.adapter.in.web.dto.TodayWorkerHistoryResponse;
import com.santotofood.application.model.TodayWorkerHistory;
import com.santotofood.application.model.UserAuthorization;
import com.santotofood.application.port.in.GetTodayWorkerHistoryUseCase;
import com.santotofood.application.port.out.AuthorizationQueryPort;
import com.santotofood.application.service.OrderAuthorizationService;
import com.santotofood.domain.model.BusinessDate;
import com.santotofood.domain.model.OrderStatus;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;

class WorkerHistoryAuthorizationTest {
  @ParameterizedTest
  @ValueSource(
      strings = {
        "NO_USER",
        "NO_ASSIGNMENT",
        "MULTIPLE_ASSIGNMENTS",
        "MULTIPLE_ROLES",
        "NO_ROLE",
        "INACTIVE",
        "CLIENT",
        "ADMIN",
        "SUPER_ADMIN"
      })
  void invalidFactsCannotReachTheHistoryQuery(String scenario) {
    UUID user = UUID.randomUUID(), cafe = UUID.randomUUID();
    var queries = mock(AuthorizationQueryPort.class);
    Set<String> roles =
        switch (scenario) {
          case "NO_ROLE" -> Set.of();
          case "MULTIPLE_ROLES" -> Set.of("WORKER", "ADMIN");
          case "CLIENT", "ADMIN", "SUPER_ADMIN" -> Set.of(scenario);
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
            scenario.equals("NO_USER")
                ? Optional.empty()
                : Optional.of(
                    new UserAuthorization(!scenario.equals("INACTIVE"), roles, assignments)));
    var history = mock(GetTodayWorkerHistoryUseCase.class);
    var controller =
        new WorkerHistoryController(
            new OrderAuthorization(new OrderAuthorizationService(queries)), history);
    var jwt =
        new JwtAuthenticationToken(
            Jwt.withTokenValue("verified-test-token")
                .header("alg", "test")
                .subject(user.toString())
                .claim("role", "WORKER")
                .claim("cafeteriaId", cafe.toString())
                .build());
    assertThrows(AccessDeniedException.class, () -> controller.today(jwt));
    verifyNoInteractions(history);
  }

  @Test
  void visualReferencesAreStableLabelsWithPossibleCollisionsNotOrderIdentity() {
    var date = new BusinessDate(LocalDate.of(2026, 10, 13));
    var first = entry("a91c6f2d-0000-0000-0000-000000000001");
    var second = entry("a91c6f2d-0000-0000-0000-000000000002");
    var response =
        TodayWorkerHistoryResponse.from(
            new TodayWorkerHistory(date, date.nextDayStartInstant(), List.of(first, second)));
    assertEquals("Pedido · A91C6F2D", response.orders().getFirst().reference());
    assertEquals(response.orders().getFirst().reference(), response.orders().getLast().reference());
    assertNotEquals(response.orders().getFirst().id(), response.orders().getLast().id());
    var reordered =
        TodayWorkerHistoryResponse.from(
            new TodayWorkerHistory(date, date.nextDayStartInstant(), List.of(second, first)));
    assertEquals(response.orders().getFirst(), reordered.orders().getLast());
  }

  static TodayWorkerHistory.Entry entry(String id) {
    return new TodayWorkerHistory.Entry(
        UUID.fromString(id),
        OrderStatus.CANCELLED,
        Instant.parse("2026-10-13T12:00:00Z"),
        BigDecimal.TEN,
        List.of());
  }
}

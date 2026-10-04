package com.santotofood.application.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.santotofood.application.exception.OrderNotFoundException;
import com.santotofood.application.model.OrderOwner;
import com.santotofood.application.model.UserAuthorization;
import com.santotofood.application.port.out.AuthorizationQueryPort;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

class ClientOrderAuthorizationServiceTest {
  final AuthorizationQueryPort queries = mock(AuthorizationQueryPort.class);
  final OrderAuthorizationService service = new OrderAuthorizationService(queries);
  final UUID userId = UUID.randomUUID();
  final UUID orderId = UUID.randomUUID();

  void facts(boolean active, Set<String> roles) {
    when(queries.findUserAuthorization(userId))
        .thenReturn(Optional.of(new UserAuthorization(active, roles, List.of())));
  }

  @Test
  void onlyTheCurrentOwnerIsAllowedWithoutAWorkerAssignment() {
    facts(true, Set.of("CLIENT"));
    when(queries.findOrderOwner(orderId))
        .thenReturn(
            Optional.of(new OrderOwner(userId)),
            Optional.of(new OrderOwner(UUID.randomUUID())),
            Optional.of(new OrderOwner(null)));
    assertTrue(service.clientOrder(userId, orderId));
    assertThrows(OrderNotFoundException.class, () -> service.clientOrder(userId, orderId));
    assertThrows(OrderNotFoundException.class, () -> service.clientOrder(userId, orderId));
    verify(queries, times(3)).findOrderOwner(orderId);
    verify(queries, never()).findOrderCafeteria(any());
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "WORKER",
        "ADMIN",
        "SUPER_ADMIN",
        "CLIENT_WORKER",
        "CLIENT_ADMIN",
        "CLIENT_SUPER_ADMIN",
        "NONE",
        "INACTIVE",
        "MISSING"
      })
  void invalidCurrentFactsDenyBeforeReadingAnOrder(String scenario) {
    Set<String> roles =
        switch (scenario) {
          case "CLIENT_WORKER" -> Set.of("CLIENT", "WORKER");
          case "CLIENT_ADMIN" -> Set.of("CLIENT", "ADMIN");
          case "CLIENT_SUPER_ADMIN" -> Set.of("CLIENT", "SUPER_ADMIN");
          case "NONE", "MISSING" -> Set.of();
          case "INACTIVE" -> Set.of("CLIENT");
          default -> Set.of(scenario);
        };
    facts(!scenario.equals("INACTIVE"), roles);
    if (scenario.equals("MISSING"))
      when(queries.findUserAuthorization(userId)).thenReturn(Optional.empty());
    assertFalse(service.clientOrder(userId, orderId));
    verify(queries, never()).findOrderOwner(any());
  }

  @Test
  void eligibleClientGetsNotFoundForAMissingOrder() {
    facts(true, Set.of("CLIENT"));
    assertThrows(OrderNotFoundException.class, () -> service.clientOrder(userId, orderId));
  }

  @Test
  void roleRevocationAndInactivationApplyOnTheNextCall() {
    when(queries.findUserAuthorization(userId))
        .thenReturn(
            Optional.of(new UserAuthorization(true, Set.of("CLIENT"), List.of())),
            Optional.of(new UserAuthorization(true, Set.of(), List.of())),
            Optional.of(new UserAuthorization(false, Set.of("CLIENT"), List.of())));
    when(queries.findOrderOwner(orderId)).thenReturn(Optional.of(new OrderOwner(userId)));
    assertTrue(service.clientOrder(userId, orderId));
    assertFalse(service.clientOrder(userId, orderId));
    assertFalse(service.clientOrder(userId, orderId));
    verify(queries, times(3)).findUserAuthorization(userId);
    verify(queries).findOrderOwner(orderId);
  }
}

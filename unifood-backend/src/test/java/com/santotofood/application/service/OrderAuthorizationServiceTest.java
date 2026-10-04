package com.santotofood.application.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.santotofood.application.model.UserAuthorization;
import com.santotofood.application.port.out.AuthorizationQueryPort;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;

class OrderAuthorizationServiceTest {
  private final AuthorizationQueryPort queries = mock(AuthorizationQueryPort.class);
  private final OrderAuthorizationService authorization = new OrderAuthorizationService(queries);
  private final UUID userId = UUID.randomUUID();
  private final UUID cafeteriaId = UUID.randomUUID();
  private final UUID orderId = UUID.randomUUID();

  static Stream<UserAuthorization> invalidUsers() {
    UUID cafeteria = UUID.randomUUID();
    return Stream.of(
        new UserAuthorization(true, Set.of("ADMIN"), List.of(cafeteria)),
        new UserAuthorization(true, Set.of("SUPER_ADMIN"), List.of(cafeteria)),
        new UserAuthorization(true, Set.of("CLIENT"), List.of(cafeteria)),
        new UserAuthorization(false, Set.of("WORKER"), List.of(cafeteria)),
        new UserAuthorization(true, Set.of("WORKER"), List.of()),
        new UserAuthorization(true, Set.of("WORKER"), List.of(cafeteria, UUID.randomUUID())),
        new UserAuthorization(true, Set.of("WORKER", "ADMIN"), List.of(cafeteria)),
        new UserAuthorization(true, Set.of("WORKER", "SUPER_ADMIN"), List.of(cafeteria)),
        new UserAuthorization(
            true, Set.of("WORKER", "ADMIN", "SUPER_ADMIN", "CLIENT"), List.of(cafeteria)),
        new UserAuthorization(true, Set.of(), List.of(cafeteria)));
  }

  @ParameterizedTest
  @MethodSource("invalidUsers")
  void invalidWorkerCannotResolveContextOrOperateAnyOrder(UserAuthorization user) {
    when(queries.findUserAuthorization(userId)).thenReturn(Optional.of(user));
    when(queries.findOrderCafeteria(orderId)).thenReturn(Optional.of(cafeteriaId));
    assertTrue(authorization.workerCafeteria(userId).isEmpty());
    assertFalse(authorization.cafeteria(userId, cafeteriaId));
    assertFalse(authorization.order(userId, orderId));
  }

  @Test
  void validWorkerCanOperateOnlyItsOwnCafeteriaAndTheOrdersActualCafeteria() {
    when(queries.findUserAuthorization(userId))
        .thenReturn(
            Optional.of(
                new UserAuthorization(true, Set.of("WORKER", "CLIENT"), List.of(cafeteriaId))));
    assertEquals(Optional.of(cafeteriaId), authorization.workerCafeteria(userId));
    assertTrue(authorization.cafeteria(userId, cafeteriaId));
    assertFalse(authorization.cafeteria(userId, UUID.randomUUID()));
    when(queries.findOrderCafeteria(orderId)).thenReturn(Optional.of(cafeteriaId));
    assertTrue(authorization.order(userId, orderId));
    when(queries.findOrderCafeteria(orderId)).thenReturn(Optional.of(UUID.randomUUID()));
    assertFalse(authorization.order(userId, orderId));
  }

  @Test
  void missingUserIsDenied() {
    when(queries.findUserAuthorization(userId)).thenReturn(Optional.empty());
    assertTrue(authorization.workerCafeteria(userId).isEmpty());
    assertFalse(authorization.cafeteria(userId, cafeteriaId));
  }

  @Test
  void missingOrderIsDeniedWithoutResolvingUserContext() {
    when(queries.findOrderCafeteria(orderId)).thenReturn(Optional.empty());
    assertFalse(authorization.order(userId, orderId));
    verify(queries, never()).findUserAuthorization(any());
  }

  @Test
  void assignmentRoleAndActivityRevocationsAreObservedOnTheNextOperation() {
    when(queries.findOrderCafeteria(orderId)).thenReturn(Optional.of(cafeteriaId));
    when(queries.findUserAuthorization(userId))
        .thenReturn(
            Optional.of(new UserAuthorization(true, Set.of("WORKER"), List.of(cafeteriaId))),
            Optional.of(new UserAuthorization(true, Set.of("WORKER"), List.of())),
            Optional.of(new UserAuthorization(true, Set.of("CLIENT"), List.of(cafeteriaId))),
            Optional.of(new UserAuthorization(false, Set.of("WORKER"), List.of(cafeteriaId))));
    assertEquals(Optional.of(cafeteriaId), authorization.workerCafeteria(userId));
    assertFalse(authorization.order(userId, orderId));
    assertFalse(authorization.order(userId, orderId));
    assertFalse(authorization.order(userId, orderId));
    verify(queries, times(4)).findUserAuthorization(userId);
  }

  @Test
  void queryFailureCannotProduceAnAuthorizationDecision() {
    when(queries.findUserAuthorization(userId)).thenThrow(new IllegalStateException("unavailable"));
    assertThrows(IllegalStateException.class, () -> authorization.cafeteria(userId, cafeteriaId));
  }
}

package com.santotofood.application.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.santotofood.application.exception.AdminCatalogForbiddenException;
import com.santotofood.application.model.UserAuthorization;
import com.santotofood.application.port.out.AdminCatalogQueryPort;
import com.santotofood.application.port.out.AuthorizationQueryPort;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

class AdminCatalogServiceTest {
  final UUID user = UUID.randomUUID(), cafe = UUID.randomUUID();
  final AuthorizationQueryPort facts = mock(AuthorizationQueryPort.class);
  final AdminCatalogQueryPort catalog = mock(AdminCatalogQueryPort.class);
  final AdminCatalogService service = new AdminCatalogService(facts, catalog);

  @ParameterizedTest
  @ValueSource(
      strings = {
        "NO_USER",
        "INACTIVE",
        "NO_ROLE",
        "CLIENT",
        "WORKER",
        "SUPER_ADMIN",
        "UNKNOWN",
        "MIXED",
        "NO_ASSIGNMENT",
        "MULTIPLE_ASSIGNMENTS",
        "DUPLICATE_ASSIGNMENT"
      })
  void invalidIdentityNeverReachesTheCatalog(String scenario) {
    Set<String> roles =
        switch (scenario) {
          case "NO_ROLE" -> Set.of();
          case "CLIENT", "WORKER", "SUPER_ADMIN", "UNKNOWN" -> Set.of(scenario);
          case "MIXED" -> Set.of("ADMIN", "WORKER");
          default -> Set.of("ADMIN");
        };
    List<UUID> assignments =
        switch (scenario) {
          case "NO_ASSIGNMENT" -> List.of();
          case "MULTIPLE_ASSIGNMENTS" -> List.of(cafe, UUID.randomUUID());
          case "DUPLICATE_ASSIGNMENT" -> List.of(cafe, cafe);
          default -> List.of(cafe);
        };
    when(facts.findUserAuthorization(user))
        .thenReturn(
            scenario.equals("NO_USER")
                ? Optional.empty()
                : Optional.of(
                    new UserAuthorization(!scenario.equals("INACTIVE"), roles, assignments)));
    assertThrows(AdminCatalogForbiddenException.class, () -> service.getAdminCatalog(user));
    verifyNoInteractions(catalog);
  }

  @Test
  void onlyTheDerivedCafeteriaIsReadAndAnEmptyCatalogIsValid() {
    when(facts.findUserAuthorization(user))
        .thenReturn(Optional.of(new UserAuthorization(true, Set.of("ADMIN"), List.of(cafe))));
    when(catalog.findByCafeteria(cafe)).thenReturn(Optional.of(List.of()));
    assertEquals(List.of(), service.getAdminCatalog(user));
    verify(catalog).findByCafeteria(cafe);
    verifyNoMoreInteractions(catalog);
  }

  @Test
  void nonexistentCafeteriaFailsClosed() {
    when(facts.findUserAuthorization(user))
        .thenReturn(Optional.of(new UserAuthorization(true, Set.of("ADMIN"), List.of(cafe))));
    when(catalog.findByCafeteria(cafe)).thenReturn(Optional.empty());
    assertThrows(AdminCatalogForbiddenException.class, () -> service.getAdminCatalog(user));
  }
}

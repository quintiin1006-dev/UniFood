package com.santotofood.application.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.santotofood.application.exception.SuperAdminForbiddenException;
import com.santotofood.application.model.SuperAdminCafeteriaRow;
import com.santotofood.application.model.UserAuthorization;
import com.santotofood.application.port.out.AuthorizationQueryPort;
import com.santotofood.application.port.out.SuperAdminCafeteriaQueryPort;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class SuperAdminCafeteriaServiceTest {
  final AuthorizationQueryPort facts = mock(AuthorizationQueryPort.class);
  final SuperAdminCafeteriaQueryPort rows = mock(SuperAdminCafeteriaQueryPort.class);
  final SuperAdminCafeteriaService service =
      new SuperAdminCafeteriaService(new OrderAuthorizationService(facts), rows);
  final UUID user = UUID.randomUUID();
  final UUID institution = UUID.randomUUID(), empty = UUID.randomUUID();
  final UUID site = UUID.randomUUID(), bare = UUID.randomUUID();
  final UUID first = UUID.randomUUID(), second = UUID.randomUUID();

  SuperAdminCafeteriaRow row(UUID siteId, UUID cafeteriaId, String name, boolean admin) {
    return new SuperAdminCafeteriaRow(
        institution,
        "Universidad",
        true,
        siteId,
        siteId == null ? null : siteId.equals(site) ? "Sede Principal" : "Sede Norte",
        siteId == null ? null : "Villavicencio",
        siteId == null ? null : siteId.equals(site),
        cafeteriaId,
        name,
        cafeteriaId == null ? null : admin,
        admin);
  }

  @Test
  void rowsBecomeAnOrderedTreeIncludingEmptySitesAndInstitutions() {
    when(facts.findUserAuthorization(user))
        .thenReturn(Optional.of(new UserAuthorization(true, Set.of("SUPER_ADMIN"), List.of())));
    when(rows.findCafeteriaTree())
        .thenReturn(
            List.of(
                row(site, first, "Cafetería Central", true),
                row(site, second, "Cafetería Norte", false),
                row(bare, null, null, false),
                new SuperAdminCafeteriaRow(
                    empty, "Otra", false, null, null, null, null, null, null, null, false)));
    var tree = service.listCafeterias(user);
    assertEquals(2, tree.size());
    var main = tree.getFirst();
    assertEquals(institution, main.id());
    assertEquals(List.of(site, bare), main.sites().stream().map(s -> s.id()).toList());
    var cafeterias = main.sites().getFirst().cafeterias();
    assertEquals(List.of(first, second), cafeterias.stream().map(c -> c.id()).toList());
    assertTrue(cafeterias.getFirst().subscribed());
    assertTrue(cafeterias.getFirst().hasActiveAdmin());
    assertFalse(cafeterias.getLast().subscribed());
    assertFalse(cafeterias.getLast().hasActiveAdmin());
    assertFalse(main.sites().getLast().active());
    assertTrue(main.sites().getLast().cafeterias().isEmpty());
    assertFalse(tree.getLast().active());
    assertTrue(tree.getLast().sites().isEmpty());
  }

  @Test
  void nonSuperAdminNeverReadsTheTree() {
    when(facts.findUserAuthorization(user))
        .thenReturn(Optional.of(new UserAuthorization(true, Set.of("ADMIN"), List.of())));
    assertThrows(SuperAdminForbiddenException.class, () -> service.listCafeterias(user));
    verifyNoInteractions(rows);
  }

  @Test
  void blankNamesAreAnInconsistencyNotAnEmptyEntry() {
    when(facts.findUserAuthorization(user))
        .thenReturn(Optional.of(new UserAuthorization(true, Set.of("SUPER_ADMIN"), List.of())));
    when(rows.findCafeteriaTree()).thenReturn(List.of(row(site, first, " ", true)));
    assertThrows(IllegalStateException.class, () -> service.listCafeterias(user));
  }
}

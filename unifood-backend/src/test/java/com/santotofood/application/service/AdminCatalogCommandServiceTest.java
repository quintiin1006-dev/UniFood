package com.santotofood.application.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.santotofood.application.exception.AdminCatalogForbiddenException;
import com.santotofood.application.model.CatalogForm;
import com.santotofood.application.model.UserAuthorization;
import com.santotofood.application.port.out.AdminCatalogCommandPort;
import com.santotofood.application.port.out.AuthorizationQueryPort;
import com.santotofood.domain.model.CatalogCategory;
import com.santotofood.domain.port.out.TimeProvider;
import java.math.BigDecimal;
import java.util.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

class AdminCatalogCommandServiceTest {
  @org.junit.jupiter.api.Test
  void formRejectsInvalidUnicodeAndNeverRoundsMoneyOrTruncatesDescriptions() {
    for (String name :
        List.of(" ", "a".repeat(151), String.valueOf((char) 0), String.valueOf((char) 0xD800)))
      assertThrows(
          com.santotofood.application.exception.AdminCatalogCommandException.class,
          () -> new CatalogForm(name, null, new BigDecimal("1.25"), CatalogCategory.CORRIENTE));
    for (String price : List.of("0", "-1", "1.001", "10000000000.00", "1E+2"))
      assertThrows(
          com.santotofood.application.exception.AdminCatalogCommandException.class,
          () -> new CatalogForm("Product", null, new BigDecimal(price), CatalogCategory.CORRIENTE));
    assertThrows(
        com.santotofood.application.exception.AdminCatalogCommandException.class,
        () ->
            new CatalogForm(
                "Product", "x".repeat(2001), new BigDecimal("1.25"), CatalogCategory.CORRIENTE));
    assertEquals(
        "18500.25",
        new CatalogForm(" Product ", null, new BigDecimal("18500.25"), CatalogCategory.CORRIENTE)
            .price()
            .toPlainString());
    assertEquals(
        "Product",
        new CatalogForm(" Product ", null, new BigDecimal("1"), CatalogCategory.CORRIENTE).name());
  }

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
  void allMutationsRejectInvalidBusinessFactsAfterGuardAndBeforeAnyProductAccess(String scenario) {
    UUID user = UUID.randomUUID(), cafe = UUID.randomUUID();
    var facts = mock(AuthorizationQueryPort.class);
    var port = mock(AdminCatalogCommandPort.class);
    var time = mock(TimeProvider.class);
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
    var service = new AdminCatalogCommandService(facts, port, time);
    var form = new CatalogForm("Product", null, new BigDecimal("1.25"), CatalogCategory.CORRIENTE);
    assertThrows(AdminCatalogForbiddenException.class, () -> service.create(user, form));
    assertThrows(
        AdminCatalogForbiddenException.class, () -> service.edit(user, UUID.randomUUID(), 0, form));
    assertThrows(
        AdminCatalogForbiddenException.class,
        () -> service.status(user, UUID.randomUUID(), 0, true));
    var order = inOrder(port, facts);
    for (int i = 0; i < 3; i++) {
      order.verify(port).lockAuthorizationGuard();
      order.verify(facts).findUserAuthorization(user);
    }
    verifyNoMoreInteractions(port, facts);
    verifyNoInteractions(time);
  }
}

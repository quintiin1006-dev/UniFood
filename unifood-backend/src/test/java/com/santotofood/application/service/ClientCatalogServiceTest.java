package com.santotofood.application.service;

import static org.junit.jupiter.api.Assertions.*;

import com.santotofood.application.exception.ClientCatalogException;
import com.santotofood.application.exception.ClientProfileNotFoundException;
import com.santotofood.application.model.ClientCatalogFacts;
import com.santotofood.application.port.out.ClientCatalogQueryPort;
import com.santotofood.domain.model.CatalogCategory;
import com.santotofood.shared.error.ErrorCode;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class ClientCatalogServiceTest {
  static final UUID USER = UUID.randomUUID();
  static final UUID CLIENT = UUID.randomUUID();
  static final UUID INSTITUTION = UUID.randomUUID();
  static final UUID CAFETERIA = UUID.randomUUID();
  // 2026-11-20 at 23:30 in Bogotá is already the 21st in UTC.
  static final Instant LATE_EVENING = Instant.parse("2026-11-21T04:30:00Z");

  static class FakeCatalog implements ClientCatalogQueryPort {
    Optional<ClientCatalogFacts> client =
        Optional.of(
            new ClientCatalogFacts(CLIENT, "Ana Torres", "STUDENT", INSTITUTION, "Universidad"));
    List<CafeteriaRow> cafeterias = new ArrayList<>();
    Optional<UUID> activeOrder = Optional.empty();
    Optional<MenuCafeteria> cafeteria =
        Optional.of(new MenuCafeteria(CAFETERIA, "Cafetería Central", true, true));
    List<MenuItem> items = new ArrayList<>();
    final List<String> calls = new ArrayList<>();

    @Override
    public Optional<ClientCatalogFacts> findClient(UUID authenticatedUserId) {
      calls.add("client:" + authenticatedUserId);
      return client;
    }

    @Override
    public List<CafeteriaRow> findActiveCafeterias(UUID institutionId, LocalDate date) {
      calls.add("cafeterias:" + institutionId + ":" + date);
      return cafeterias;
    }

    @Override
    public Optional<UUID> findActiveOrder(UUID clientId) {
      calls.add("order:" + clientId);
      return activeOrder;
    }

    @Override
    public Optional<MenuCafeteria> findCafeteria(
        UUID institutionId, UUID cafeteriaId, LocalDate date) {
      calls.add("cafeteria:" + institutionId + ":" + cafeteriaId + ":" + date);
      return cafeteria;
    }

    @Override
    public List<MenuItem> findMenuItems(UUID cafeteriaId, LocalDate date) {
      calls.add("items:" + cafeteriaId + ":" + date);
      return items;
    }
  }

  static ClientCatalogQueryPort.MenuItem item(
      String name, CatalogCategory category, boolean available) {
    return new ClientCatalogQueryPort.MenuItem(
        UUID.randomUUID(), name, null, new BigDecimal("13000.00"), category, available);
  }

  FakeCatalog catalog = new FakeCatalog();
  ClientCatalogService service = new ClientCatalogService(catalog, () -> LATE_EVENING);

  @Test
  void contextGroupsActiveCafeteriasBySiteForTheClientsInstitutionAndBogotaDate() {
    UUID site = UUID.randomUUID(), other = UUID.randomUUID(), order = UUID.randomUUID();
    catalog.cafeterias.add(
        new ClientCatalogQueryPort.CafeteriaRow(
            site, "Sede Principal", CAFETERIA, "Central", true));
    catalog.cafeterias.add(
        new ClientCatalogQueryPort.CafeteriaRow(site, "Sede Principal", other, "Norte", false));
    catalog.activeOrder = Optional.of(order);

    var context = service.getClientContext(USER);

    assertEquals("Ana Torres", context.fullName());
    assertEquals("STUDENT", context.clientType());
    assertEquals(INSTITUTION, context.institution().id());
    assertEquals(1, context.sites().size());
    assertEquals(
        List.of(true, false),
        context.sites().getFirst().cafeterias().stream().map(c -> c.open()).toList());
    assertEquals(order, context.activeOrderId());
    assertTrue(catalog.calls.contains("cafeterias:" + INSTITUTION + ":2026-11-20"));
  }

  @Test
  void contextWithoutCafeteriasOrOrderIsEmptyNotAnError() {
    var context = service.getClientContext(USER);
    assertEquals(List.of(), context.sites());
    assertNull(context.activeOrderId());
  }

  @Test
  void menuListsOnlyCategoriesWithProductsInHomeFilterOrder() {
    catalog.items.addAll(
        List.of(
            item("Jugo", CatalogCategory.BEBIDA, true),
            item("Ejecutivo", CatalogCategory.EJECUTIVO, true),
            item("Especial", CatalogCategory.ESPECIAL, false),
            item("Del día", CatalogCategory.DEL_DIA, true),
            item("Calentado", CatalogCategory.DESAYUNO, true)));

    var menu = service.getClientMenu(USER, CAFETERIA);

    assertEquals(
        List.of("DEL_DIA", "DESAYUNO", "EJECUTIVO", "ESPECIAL", "BEBIDA"),
        menu.categories().stream().map(c -> c.id()).toList());
    assertEquals(LocalDate.parse("2026-11-20"), menu.businessDate());
    assertTrue(menu.cafeteria().open());
    // Not available today stays listed, marked unavailable.
    var especial = menu.categories().get(3).products().getFirst();
    assertFalse(especial.available());
    assertTrue(
        catalog.calls.contains("cafeteria:" + INSTITUTION + ":" + CAFETERIA + ":2026-11-20"));
  }

  @Test
  void closedCafeteriaListsActiveProductsButNoneIsAvailable() {
    catalog.cafeteria =
        Optional.of(
            new ClientCatalogQueryPort.MenuCafeteria(CAFETERIA, "Cafetería Central", true, false));
    catalog.items.addAll(
        List.of(
            item("Corriente", CatalogCategory.CORRIENTE, true),
            item("Jugo", CatalogCategory.BEBIDA, true)));

    var menu = service.getClientMenu(USER, CAFETERIA);

    assertFalse(menu.cafeteria().open());
    assertEquals(2, menu.categories().size());
    assertTrue(
        menu.categories().stream()
            .flatMap(c -> c.products().stream())
            .noneMatch(product -> product.available()));
  }

  @Test
  void missingOrForeignCafeteriaIsTheSameNotFound() {
    catalog.cafeteria = Optional.empty();
    var error =
        assertThrows(ClientCatalogException.class, () -> service.getClientMenu(USER, CAFETERIA));
    assertEquals(ErrorCode.CAFETERIA_NOT_FOUND, error.getCode());
    assertEquals("No encontramos esa cafetería.", error.getMessage());
    assertFalse(catalog.calls.stream().anyMatch(call -> call.startsWith("items:")));
  }

  @Test
  void inactiveCafeteriaOfTheOwnInstitutionIsNotSubscribed() {
    catalog.cafeteria =
        Optional.of(
            new ClientCatalogQueryPort.MenuCafeteria(CAFETERIA, "Cafetería Central", false, true));
    var error =
        assertThrows(ClientCatalogException.class, () -> service.getClientMenu(USER, CAFETERIA));
    assertEquals(ErrorCode.CAFETERIA_NOT_SUBSCRIBED, error.getCode());
    assertFalse(catalog.calls.stream().anyMatch(call -> call.startsWith("items:")));
  }

  @Test
  void accountWithoutClientProfileGetsTheProfileNotFound() {
    catalog.client = Optional.empty();
    assertThrows(ClientProfileNotFoundException.class, () -> service.getClientContext(USER));
    assertThrows(
        ClientProfileNotFoundException.class, () -> service.getClientMenu(USER, CAFETERIA));
  }

  @Test
  void productsOfAnUnknownCategoryAreLeftOut() {
    catalog.items.add(item("Sin categoría", null, true));
    catalog.items.add(item("Jugo", CatalogCategory.BEBIDA, true));
    var menu = service.getClientMenu(USER, CAFETERIA);
    assertEquals(List.of("BEBIDA"), menu.categories().stream().map(c -> c.id()).toList());
  }
}

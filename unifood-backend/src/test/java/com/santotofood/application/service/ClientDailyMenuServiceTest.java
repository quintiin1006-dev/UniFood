package com.santotofood.application.service;

import static org.junit.jupiter.api.Assertions.*;

import com.santotofood.application.exception.ClientCatalogException;
import com.santotofood.application.exception.DailyMenuException;
import com.santotofood.application.model.ClientCatalogFacts;
import com.santotofood.application.port.out.ClientCatalogQueryPort;
import com.santotofood.domain.port.out.DailyMenuReadRepository;
import com.santotofood.domain.port.out.DailyMenuReadRepository.Kind;
import com.santotofood.shared.error.ErrorCode;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class ClientDailyMenuServiceTest {
  static final UUID USER = UUID.randomUUID();
  static final UUID INSTITUTION = UUID.randomUUID();
  static final UUID CAFETERIA = UUID.randomUUID();
  static final UUID PROTEIN = UUID.randomUUID();
  static final UUID SIDES = UUID.randomUUID();
  static final UUID EXTRAS = UUID.randomUUID();
  // 2026-11-20 at 23:30 in Bogotá is already the 21st in UTC.
  static final Instant LATE_EVENING = Instant.parse("2026-11-21T04:30:00Z");
  static final LocalDate BOGOTA_DAY = LocalDate.of(2026, 11, 20);

  static class FakeCatalog implements ClientCatalogQueryPort {
    Optional<MenuCafeteria> cafeteria =
        Optional.of(new MenuCafeteria(CAFETERIA, "Cafetería Central", true, true));

    @Override
    public Optional<ClientCatalogFacts> findClient(UUID authenticatedUserId) {
      return Optional.of(
          new ClientCatalogFacts(UUID.randomUUID(), "Ana", "STUDENT", INSTITUTION, "U"));
    }

    @Override
    public List<CafeteriaRow> findActiveCafeterias(UUID institutionId, LocalDate date) {
      return List.of();
    }

    @Override
    public Optional<UUID> findActiveOrder(UUID clientId) {
      return Optional.empty();
    }

    @Override
    public Optional<MenuCafeteria> findCafeteria(
        UUID institutionId, UUID cafeteriaId, LocalDate date) {
      assertEquals(INSTITUTION, institutionId);
      return cafeteria;
    }

    @Override
    public List<MenuItem> findMenuItems(UUID cafeteriaId, LocalDate date) {
      return List.of();
    }
  }

  /** Stands for the database: it only ever answers for the Bogotá business date asked. */
  static class FakeMenus implements DailyMenuReadRepository {
    Optional<PublishedDay> day =
        Optional.of(new PublishedDay("Almuerzo del día", new BigDecimal("9500.00")));
    List<Category> categories =
        new ArrayList<>(
            List.of(
                new Category(PROTEIN, "Proteína", Kind.SINGLE, false),
                new Category(SIDES, "Acompañamientos", Kind.SINGLE, true),
                new Category(EXTRAS, "Adiciones", Kind.ADDITIONS, true)));
    List<Option> options =
        new ArrayList<>(List.of(new Option(UUID.randomUUID(), PROTEIN, "Pollo a la plancha")));
    List<Addition> additions =
        new ArrayList<>(
            List.of(new Addition(UUID.randomUUID(), "Huevo frito", new BigDecimal("2000.00"))));
    final List<LocalDate> dates = new ArrayList<>();

    @Override
    public Optional<PublishedDay> findPublishedDay(UUID cafeteriaId, LocalDate businessDate) {
      dates.add(businessDate);
      return day;
    }

    @Override
    public List<Category> findActiveCategories(UUID cafeteriaId) {
      return categories;
    }

    @Override
    public List<Option> findOptions(UUID cafeteriaId, LocalDate businessDate) {
      dates.add(businessDate);
      return options;
    }

    @Override
    public List<Addition> findAvailableAdditions(UUID cafeteriaId, LocalDate businessDate) {
      dates.add(businessDate);
      return additions;
    }
  }

  final FakeCatalog catalog = new FakeCatalog();
  final FakeMenus menus = new FakeMenus();
  boolean enabled = true;
  final ClientDailyMenuService service =
      new ClientDailyMenuService(() -> enabled, catalog, menus, () -> LATE_EVENING);

  @Test
  void publishedCompleteMenuFollowsTheContractForTheBogotaBusinessDate() {
    var menu = service.getClientDailyMenu(USER, CAFETERIA);
    assertEquals(BOGOTA_DAY, menu.businessDate());
    assertTrue(menus.dates.stream().allMatch(BOGOTA_DAY::equals));
    assertEquals("Almuerzo del día", menu.title());
    assertEquals(new BigDecimal("9500.00"), menu.price());
    assertTrue(menu.cafeteria().open());
    assertEquals(
        List.of("Proteína", "Acompañamientos", "Adiciones"),
        menu.categories().stream().map(c -> c.label()).toList());
    var protein = menu.categories().get(0);
    assertEquals("SINGLE", protein.kind());
    assertFalse(protein.canSkip());
    assertEquals("Pollo a la plancha", protein.options().get(0).label());
    assertNull(protein.additions());
    var extras = menu.categories().get(2);
    assertEquals("ADDITIONS", extras.kind());
    assertNull(extras.options());
    assertEquals(new BigDecimal("2000.00"), extras.additions().get(0).extraPrice());
  }

  @Test
  void flagOffIsDisabledBeforeAnyLookup() {
    enabled = false;
    catalog.cafeteria = Optional.empty();
    var error =
        assertThrows(DailyMenuException.class, () -> service.getClientDailyMenu(USER, CAFETERIA));
    assertEquals(ErrorCode.DAILY_MENU_DISABLED, error.getCode());
    assertTrue(menus.dates.isEmpty());
  }

  @Test
  void unpublishedDayIsNotPublished() {
    menus.day = Optional.empty();
    var error =
        assertThrows(DailyMenuException.class, () -> service.getClientDailyMenu(USER, CAFETERIA));
    assertEquals(ErrorCode.DAILY_MENU_NOT_PUBLISHED, error.getCode());
  }

  @Test
  void publishedButIncompleteIsNotPublished() {
    menus.options.clear();
    var error =
        assertThrows(DailyMenuException.class, () -> service.getClientDailyMenu(USER, CAFETERIA));
    assertEquals(ErrorCode.DAILY_MENU_NOT_PUBLISHED, error.getCode());
  }

  @Test
  void skippableCategoryWithoutOptionsComesWithAnEmptyList() {
    var sides = service.getClientDailyMenu(USER, CAFETERIA).categories().get(1);
    assertEquals("Acompañamientos", sides.label());
    assertTrue(sides.canSkip());
    assertEquals(List.of(), sides.options());
  }

  @Test
  void additionsCategoryWithoutAdditionsSwitchedOnIsLeftOut() {
    // The repository only returns additions switched on today and active in the catalog.
    menus.additions.clear();
    var menu = service.getClientDailyMenu(USER, CAFETERIA);
    assertEquals(
        List.of("SINGLE", "SINGLE"), menu.categories().stream().map(c -> c.kind()).toList());
  }

  @Test
  void onlyTheAdditionsTheRepositoryReturnsAreServed() {
    var kept = new DailyMenuReadRepository.Addition(UUID.randomUUID(), "Tajada", BigDecimal.TEN);
    menus.additions = new ArrayList<>(List.of(kept));
    var extras = service.getClientDailyMenu(USER, CAFETERIA).categories().get(2);
    assertEquals(List.of("Tajada"), extras.additions().stream().map(a -> a.name()).toList());
  }

  @Test
  void titleAndPriceAreTheDaySnapshotsNotTheCurrentSettings() {
    // Settings are never read: whatever they hold now, the published copy is what is served.
    menus.day =
        Optional.of(
            new DailyMenuReadRepository.PublishedDay("Plato de ayer", new BigDecimal("8000.00")));
    var menu = service.getClientDailyMenu(USER, CAFETERIA);
    assertEquals("Plato de ayer", menu.title());
    assertEquals(new BigDecimal("8000.00"), menu.price());
  }

  @Test
  void closedCafeteriaStillServesTheMenuWithOpenFalse() {
    catalog.cafeteria =
        Optional.of(
            new ClientCatalogQueryPort.MenuCafeteria(CAFETERIA, "Cafetería Central", true, false));
    var menu = service.getClientDailyMenu(USER, CAFETERIA);
    assertFalse(menu.cafeteria().open());
    assertEquals(3, menu.categories().size());
  }

  @Test
  void visibilityIsTheCatalogsOwnAndComesBeforeTheMenu() {
    catalog.cafeteria = Optional.empty();
    var missing =
        assertThrows(
            ClientCatalogException.class, () -> service.getClientDailyMenu(USER, CAFETERIA));
    assertEquals(ErrorCode.CAFETERIA_NOT_FOUND, missing.getCode());
    catalog.cafeteria =
        Optional.of(new ClientCatalogQueryPort.MenuCafeteria(CAFETERIA, "Inactiva", false, false));
    var inactive =
        assertThrows(
            ClientCatalogException.class, () -> service.getClientDailyMenu(USER, CAFETERIA));
    assertEquals(ErrorCode.CAFETERIA_NOT_SUBSCRIBED, inactive.getCode());
    assertTrue(menus.dates.isEmpty());
  }
}

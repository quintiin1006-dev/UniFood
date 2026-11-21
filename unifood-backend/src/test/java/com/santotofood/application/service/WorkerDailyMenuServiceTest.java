package com.santotofood.application.service;

import static org.junit.jupiter.api.Assertions.*;

import com.santotofood.application.exception.DailyMenuException;
import com.santotofood.domain.port.out.DailyMenuReadRepository;
import com.santotofood.domain.port.out.DailyMenuWriteRepository;
import com.santotofood.shared.error.ErrorCode;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.*;
import java.util.function.Supplier;
import org.junit.jupiter.api.Test;

class WorkerDailyMenuServiceTest {
  static final UUID CAFE = UUID.randomUUID();
  static final UUID WORKER = UUID.randomUUID();
  static final UUID PROTEIN = UUID.randomUUID();
  static final UUID STARCH = UUID.randomUUID();
  static final UUID DRINK = UUID.randomUUID();
  static final UUID EXTRAS = UUID.randomUUID();
  static final UUID EGG = UUID.randomUUID();
  static final UUID CHEESE = UUID.randomUUID();
  // 2026-11-20 at 23:30 in Bogotá is already the 21st in UTC.
  static final Instant LATE_EVENING = Instant.parse("2026-11-21T04:30:00Z");
  static final LocalDate TODAY = LocalDate.of(2026, 11, 20);
  static final LocalDate YESTERDAY = TODAY.minusDays(1);

  /** In-memory stand-in for the 031 tables of one cafeteria. */
  static class Store implements DailyMenuReadRepository, DailyMenuWriteRepository {
    Optional<Settings> settings =
        Optional.of(new Settings("Almuerzo del día", new BigDecimal("9500.00")));
    final List<Category> categories =
        new ArrayList<>(
            List.of(
                new Category(PROTEIN, "Proteína", Kind.SINGLE, false),
                new Category(STARCH, "Principio", Kind.SINGLE, false),
                new Category(DRINK, "Bebida", Kind.SINGLE, true),
                new Category(EXTRAS, "Adiciones", Kind.ADDITIONS, true)));
    final Map<LocalDate, Day> days = new HashMap<>();
    final Map<LocalDate, List<Option>> options = new HashMap<>();
    final Map<UUID, CatalogAddition> catalog = new LinkedHashMap<>();
    final Map<LocalDate, Map<UUID, WorkerAddition>> switched = new HashMap<>();
    UUID publishedBy;

    Store() {
      catalog.put(EGG, new CatalogAddition(EGG, "Huevo frito", new BigDecimal("2000.00"), true));
      catalog.put(CHEESE, new CatalogAddition(CHEESE, "Queso", new BigDecimal("1500.00"), false));
    }

    List<Option> of(LocalDate date) {
      return options.computeIfAbsent(date, d -> new ArrayList<>());
    }

    @Override
    public Optional<PublishedDay> findPublishedDay(UUID cafeteriaId, LocalDate businessDate) {
      return Optional.ofNullable(days.get(businessDate))
          .filter(Day::published)
          .map(day -> new PublishedDay(day.titleSnapshot(), day.priceSnapshot()));
    }

    @Override
    public List<Category> findActiveCategories(UUID cafeteriaId) {
      return List.copyOf(categories);
    }

    @Override
    public List<Option> findOptions(UUID cafeteriaId, LocalDate businessDate) {
      return List.copyOf(of(businessDate));
    }

    @Override
    public List<Addition> findAvailableAdditions(UUID cafeteriaId, LocalDate businessDate) {
      return List.of();
    }

    @Override
    public Optional<Settings> findSettings(UUID cafeteriaId) {
      return settings;
    }

    @Override
    public Optional<Day> findDay(UUID cafeteriaId, LocalDate businessDate) {
      return Optional.ofNullable(days.get(businessDate));
    }

    @Override
    public Day lockDay(UUID cafeteriaId, LocalDate businessDate) {
      return days.computeIfAbsent(businessDate, d -> new Day(0, false, null, null));
    }

    @Override
    public List<WorkerAddition> findWorkerAdditions(UUID cafeteriaId, LocalDate businessDate) {
      var today = switched.getOrDefault(businessDate, Map.of());
      return catalog.values().stream()
          .filter(CatalogAddition::active)
          .map(
              a ->
                  today.containsKey(a.id()) && today.get(a.id()).available()
                      ? today.get(a.id())
                      : new WorkerAddition(a.id(), a.name(), a.extraPrice(), false))
          .toList();
    }

    @Override
    public Optional<CatalogAddition> lockAddition(UUID cafeteriaId, UUID additionId) {
      return Optional.ofNullable(catalog.get(additionId));
    }

    @Override
    public void replaceOptions(
        UUID cafeteriaId, LocalDate businessDate, UUID categoryId, List<String> labels) {
      of(businessDate).removeIf(o -> o.categoryId().equals(categoryId));
      labels.forEach(l -> of(businessDate).add(new Option(UUID.randomUUID(), categoryId, l)));
    }

    @Override
    public void copyOptions(UUID cafeteriaId, LocalDate from, LocalDate to, UUID categoryId) {
      of(from).stream()
          .filter(o -> o.categoryId().equals(categoryId))
          .toList()
          .forEach(o -> of(to).add(new Option(UUID.randomUUID(), categoryId, o.label())));
    }

    @Override
    public void setAddition(
        UUID cafeteriaId, LocalDate businessDate, UUID additionId, boolean on, BigDecimal price) {
      var today = switched.computeIfAbsent(businessDate, d -> new HashMap<>());
      var old = today.get(additionId);
      var keep = old != null && (old.available() || !on) ? old.extraPrice() : price;
      today.put(
          additionId, new WorkerAddition(additionId, catalog.get(additionId).name(), keep, on));
    }

    @Override
    public void publish(
        UUID cafeteriaId, LocalDate businessDate, String title, BigDecimal price, UUID workerId) {
      var day = days.get(businessDate);
      days.put(businessDate, new Day(day.version(), true, title, price));
      publishedBy = workerId;
    }

    @Override
    public void unpublish(UUID cafeteriaId, LocalDate businessDate) {
      var day = days.get(businessDate);
      days.put(
          businessDate, new Day(day.version(), false, day.titleSnapshot(), day.priceSnapshot()));
    }

    @Override
    public long bumpVersion(UUID cafeteriaId, LocalDate businessDate) {
      var day = days.get(businessDate);
      days.put(
          businessDate,
          new Day(day.version() + 1, day.published(), day.titleSnapshot(), day.priceSnapshot()));
      return day.version() + 1;
    }
  }

  final Store store = new Store();
  boolean enabled = true;
  Instant now = LATE_EVENING;
  final WorkerDailyMenuService service =
      new WorkerDailyMenuService(() -> enabled, store, store, () -> now);

  static ErrorCode code(Supplier<?> call) {
    return assertThrows(DailyMenuException.class, call::get).getCode();
  }

  void fill() {
    service.replaceOptions(CAFE, TODAY, 0, PROTEIN, List.of("Pollo a la plancha"));
    service.replaceOptions(CAFE, TODAY, 1, STARCH, List.of("Arroz", "Lentejas"));
  }

  @Test
  void emptyDayBeforeAnyWriteIsVersionZeroAndIncomplete() {
    var menu = service.getToday(CAFE);
    assertEquals(TODAY, menu.businessDate());
    assertEquals(0, menu.version());
    assertFalse(menu.published());
    assertFalse(menu.complete());
    assertEquals(List.of("Proteína", "Principio"), menu.missingCategories());
    assertTrue(menu.priceSet());
    assertEquals(new BigDecimal("9500.00"), menu.price());
    // Only SINGLE categories; additions go apart, and only active catalog ones.
    assertEquals(3, menu.categories().size());
    assertEquals(List.of(EGG), menu.additions().stream().map(a -> a.id()).toList());
    assertNull(menu.skippedCategories());
  }

  @Test
  void writesNormalizeBumpTheVersionAndReportTextUsed() {
    var menu = service.replaceOptions(CAFE, TODAY, 0, PROTEIN, List.of("  Pollo   frito ", "Res"));
    assertEquals(1, menu.version());
    var protein = menu.categories().get(0);
    assertEquals(
        List.of("Pollo frito", "Res"), protein.options().stream().map(o -> o.label()).toList());
    assertEquals(14, protein.textUsed());
  }

  @Test
  void staleVersionIsAConflictAndChangesNothing() {
    service.replaceOptions(CAFE, TODAY, 0, PROTEIN, List.of("Pollo"));
    assertEquals(
        ErrorCode.DAILY_MENU_VERSION_CONFLICT,
        code(() -> service.replaceOptions(CAFE, TODAY, 0, PROTEIN, List.of("Res"))));
    assertEquals("Pollo", store.of(TODAY).get(0).label());
  }

  @Test
  void flagOffAnswersDisabledForReadsAndWrites() {
    enabled = false;
    assertEquals(ErrorCode.DAILY_MENU_DISABLED, code(() -> service.getToday(CAFE)));
    assertEquals(
        ErrorCode.DAILY_MENU_DISABLED,
        code(() -> service.replaceOptions(CAFE, TODAY, 0, PROTEIN, List.of("x"))));
    assertEquals(
        ErrorCode.DAILY_MENU_DISABLED, code(() -> service.publish(CAFE, WORKER, TODAY, 0)));
    assertTrue(store.days.isEmpty());
  }

  @Test
  void aScreenFromAnotherDayCannotWrite() {
    assertEquals(
        ErrorCode.DAILY_MENU_DATE_CHANGED,
        code(() -> service.replaceOptions(CAFE, YESTERDAY, 0, PROTEIN, List.of("x"))));
    assertTrue(store.days.isEmpty());
  }

  @Test
  void onlyActiveSingleCategoriesTakeOptions() {
    for (UUID category : List.of(EXTRAS, UUID.randomUUID()))
      assertEquals(
          ErrorCode.DAILY_MENU_CATEGORY_NOT_FOUND,
          code(() -> service.replaceOptions(CAFE, TODAY, 0, category, List.of("x"))));
  }

  @Test
  void publishingIncompleteListsWhatIsMissing() {
    service.replaceOptions(CAFE, TODAY, 0, PROTEIN, List.of("Pollo"));
    var error =
        assertThrows(DailyMenuException.class, () -> service.publish(CAFE, WORKER, TODAY, 1));
    assertEquals(ErrorCode.DAILY_MENU_INCOMPLETE, error.getCode());
    assertEquals(List.of("Principio"), error.getMissingCategories());
    assertFalse(store.days.get(TODAY).published());
  }

  @Test
  void publishingWithoutPlatePriceIsRefused() {
    fill();
    store.settings = Optional.of(new DailyMenuWriteRepository.Settings("Almuerzo del día", null));
    assertEquals(
        ErrorCode.DAILY_MENU_PRICE_NOT_SET, code(() -> service.publish(CAFE, WORKER, TODAY, 2)));
    store.settings = Optional.empty();
    assertEquals(
        ErrorCode.DAILY_MENU_PRICE_NOT_SET, code(() -> service.publish(CAFE, WORKER, TODAY, 2)));
    assertFalse(service.getToday(CAFE).priceSet());
  }

  @Test
  void publishingFreezesTitleAndPriceAndRepublishingFreezesThemAgain() {
    fill();
    var menu = service.publish(CAFE, WORKER, TODAY, 2);
    assertTrue(menu.published());
    assertTrue(menu.complete());
    assertEquals(WORKER, store.publishedBy);
    store.settings =
        Optional.of(
            new DailyMenuWriteRepository.Settings("Plato nuevo", new BigDecimal("12000.00")));
    // Published: the worker still sees the frozen copy.
    assertEquals(new BigDecimal("9500.00"), service.getToday(CAFE).price());
    menu = service.unpublish(CAFE, TODAY, 3);
    assertFalse(menu.published());
    assertEquals("Plato nuevo", menu.title());
    menu = service.publish(CAFE, WORKER, TODAY, 4);
    assertEquals("Plato nuevo", menu.title());
    assertEquals(new BigDecimal("12000.00"), menu.price());
    assertEquals(5, menu.version());
  }

  @Test
  void switchingAnAdditionOnFreezesItsPriceAtThatMoment() {
    var menu = service.setAddition(CAFE, TODAY, 0, EGG, true);
    assertTrue(menu.additions().get(0).available());
    store.catalog.put(
        EGG,
        new DailyMenuWriteRepository.CatalogAddition(
            EGG, "Huevo frito", new BigDecimal("3000.00"), true));
    // Already on: the frozen price stays.
    menu = service.setAddition(CAFE, TODAY, 1, EGG, true);
    assertEquals(new BigDecimal("2000.00"), menu.additions().get(0).extraPrice());
    // Off and on again: the price of that new moment.
    service.setAddition(CAFE, TODAY, 2, EGG, false);
    menu = service.setAddition(CAFE, TODAY, 3, EGG, true);
    assertEquals(new BigDecimal("3000.00"), menu.additions().get(0).extraPrice());
  }

  @Test
  void inactiveOrMissingAdditionsCannotBeSwitchedOn() {
    assertEquals(
        ErrorCode.DAILY_MENU_ADDITION_UNAVAILABLE,
        code(() -> service.setAddition(CAFE, TODAY, 0, CHEESE, true)));
    assertEquals(
        ErrorCode.DAILY_MENU_ADDITION_UNAVAILABLE,
        code(() -> service.setAddition(CAFE, TODAY, 0, UUID.randomUUID(), false)));
    // Switching an inactive one off is allowed.
    assertEquals(1, service.setAddition(CAFE, TODAY, 0, CHEESE, false).version());
  }

  @Test
  void copyYesterdayFillsOnlyEmptyCategoriesAndNeverAdditions() {
    store
        .of(YESTERDAY)
        .add(new DailyMenuReadRepository.Option(UUID.randomUUID(), PROTEIN, "Cerdo"));
    store.of(YESTERDAY).add(new DailyMenuReadRepository.Option(UUID.randomUUID(), STARCH, "Arroz"));
    store.days.put(YESTERDAY, new DailyMenuWriteRepository.Day(4, true, "x", BigDecimal.TEN));
    store.switched.put(
        YESTERDAY,
        new HashMap<>(
            Map.of(
                EGG,
                new DailyMenuWriteRepository.WorkerAddition(
                    EGG, "Huevo frito", BigDecimal.TEN, true))));
    service.replaceOptions(CAFE, TODAY, 0, PROTEIN, List.of("Pollo"));

    var menu = service.copyYesterday(CAFE, TODAY, 1);
    assertEquals(List.of("Proteína"), menu.skippedCategories());
    assertEquals(
        List.of("Pollo"), menu.categories().get(0).options().stream().map(o -> o.label()).toList());
    assertEquals(
        List.of("Arroz"), menu.categories().get(1).options().stream().map(o -> o.label()).toList());
    assertFalse(menu.additions().get(0).available());
    assertFalse(menu.published());
  }

  @Test
  void eachBusinessDateStartsEmpty() {
    fill();
    service.publish(CAFE, WORKER, TODAY, 2);
    now = now.plusSeconds(3600); // 00:30 of the 21st in Bogotá.
    var next = service.getToday(CAFE);
    assertEquals(TODAY.plusDays(1), next.businessDate());
    assertEquals(0, next.version());
    assertFalse(next.published());
    assertTrue(next.categories().stream().allMatch(c -> c.options().isEmpty()));
  }
}

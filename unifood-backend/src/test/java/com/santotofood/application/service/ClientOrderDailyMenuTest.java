package com.santotofood.application.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

import com.santotofood.application.exception.ClientOrderException;
import com.santotofood.application.model.ClientOrder;
import com.santotofood.application.port.in.CreateOwnOrderUseCase.Choice;
import com.santotofood.application.port.in.CreateOwnOrderUseCase.DailyMenuRequest;
import com.santotofood.application.port.in.CreateOwnOrderUseCase.Line;
import com.santotofood.application.port.in.CreateOwnOrderUseCase.OrderRequest;
import com.santotofood.application.port.out.ClientOrderCommandPort;
import com.santotofood.application.port.out.ClientOrderCommandPort.LockedCafeteria;
import com.santotofood.application.port.out.ClientOrderCommandPort.LockedProduct;
import com.santotofood.application.port.out.ClientOrderCommandPort.NewChoice;
import com.santotofood.application.port.out.ClientOrderCommandPort.NewOrder;
import com.santotofood.application.port.out.ClientOrderCommandPort.OrderingClient;
import com.santotofood.application.port.out.ClientOrderCommandPort.PublishedDailyMenu;
import com.santotofood.domain.port.out.DailyMenuReadRepository;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.SimpleTransactionStatus;

/**
 * Daily menu order rules on stubbed facts; locks and JDBC run in ClientOrderDailyMenuPostgresTest.
 */
class ClientOrderDailyMenuTest {
  static final UUID USER = UUID.randomUUID();
  static final UUID INSTITUTION = UUID.randomUUID();
  static final UUID CAFETERIA = ClientDailyMenuServiceTest.CAFETERIA;
  static final UUID PROTEIN = ClientDailyMenuServiceTest.PROTEIN;
  static final UUID SIDES = ClientDailyMenuServiceTest.SIDES;
  static final UUID JUICE = UUID.randomUUID();
  static final String KEY = "key-0123456789abcdef";
  // 2026-11-20 12:00 in America/Bogota.
  static final Instant NOW = Instant.parse("2026-11-20T17:00:00Z");
  static final LocalDate TODAY = LocalDate.parse("2026-11-20");
  static final OrderingClient CLIENT =
      new OrderingClient(UUID.randomUUID(), "Ana Torres", INSTITUTION, "STUDENT", "1234567");

  ClientOrderCommandPort port;
  ClientDailyMenuServiceTest.FakeMenus menus;
  boolean enabled = true;
  ClientOrderCreationService service;
  // Fixed ids: several tests rebuild the fixture and must keep naming the same option.
  static final UUID CHICKEN = UUID.randomUUID();
  static final UUID EGG = UUID.randomUUID();
  final UUID chicken = CHICKEN;
  final UUID egg = EGG;

  @BeforeEach
  void setUp() {
    port = mock(ClientOrderCommandPort.class);
    var manager = mock(PlatformTransactionManager.class);
    when(manager.getTransaction(any())).thenAnswer(call -> new SimpleTransactionStatus());
    menus = new ClientDailyMenuServiceTest.FakeMenus();
    menus.options =
        new ArrayList<>(
            List.of(new DailyMenuReadRepository.Option(CHICKEN, PROTEIN, "Pollo a la plancha")));
    menus.additions =
        new ArrayList<>(
            List.of(
                new DailyMenuReadRepository.Addition(
                    EGG, "Huevo frito", new BigDecimal("2000.00"))));
    service =
        new ClientOrderCreationService(port, () -> NOW, manager, event -> {}, () -> enabled, menus);
    when(port.findOrderingClient(USER)).thenReturn(Optional.of(CLIENT));
    when(port.findByIdempotencyKey(any(), any())).thenReturn(Optional.empty());
    when(port.findActiveOrder(any())).thenReturn(Optional.empty());
    when(port.lockCafeteria(INSTITUTION, CAFETERIA))
        .thenReturn(Optional.of(new LockedCafeteria(CAFETERIA, true)));
    when(port.lockOpenToday(CAFETERIA, TODAY)).thenReturn(true);
    when(port.lockProducts(eq(CAFETERIA), anyList()))
        .thenReturn(List.of(new LockedProduct(JUICE, "Jugo", new BigDecimal("4500.00"), true)));
    when(port.lockAvailableToday(eq(CAFETERIA), anyList(), eq(TODAY))).thenReturn(Set.of(JUICE));
    when(port.lockPublishedDailyMenu(CAFETERIA, TODAY))
        .thenReturn(
            Optional.of(new PublishedDailyMenu("Almuerzo del día", new BigDecimal("9500.00"))));
    when(port.findOrder(any()))
        .thenAnswer(
            call ->
                Optional.of(
                    new ClientOrder(
                        call.getArgument(0),
                        "PENDING",
                        BigDecimal.TEN,
                        null,
                        NOW,
                        List.of(),
                        new ClientOrder.Cafeteria(CAFETERIA, "Cafetería Central"),
                        null,
                        null,
                        new ClientOrder.Timeline(NOW, null, 0, null, null, null, null),
                        null)));
  }

  DailyMenuRequest plate(List<UUID> additions) {
    return new DailyMenuRequest(
        TODAY,
        List.of(new Choice(PROTEIN, chicken, false), new Choice(SIDES, null, true)),
        additions);
  }

  OrderRequest order(List<Line> items, DailyMenuRequest menu) {
    return new OrderRequest(CAFETERIA, items, null, null, menu);
  }

  String code(Runnable call) {
    return assertThrows(ClientOrderException.class, call::run).getCode();
  }

  NewOrder inserted() {
    var order = ArgumentCaptor.forClass(NewOrder.class);
    verify(port).insertOrder(order.capture());
    return order.getValue();
  }

  @SuppressWarnings("unchecked")
  List<NewChoice> copied() {
    ArgumentCaptor<List<NewChoice>> choices = ArgumentCaptor.forClass(List.class);
    verify(port).insertDailyMenu(any(), eq(CAFETERIA), eq(TODAY), any(), choices.capture());
    return choices.getValue();
  }

  @Test
  void totalIsProductsPlusFrozenPlatePlusFrozenAdditions() {
    service.createOwnOrder(USER, KEY, order(List.of(new Line(JUICE, 2)), plate(List.of(egg))));
    // 2 × 4500 + 9500 + 2000, never a price from the client.
    assertEquals(0, new BigDecimal("20500.00").compareTo(inserted().total()));
    var choices = copied();
    assertEquals(
        List.of("OPTION", "NONE", "ADDITION"), choices.stream().map(NewChoice::kind).toList());
    assertEquals("Pollo a la plancha", choices.get(0).label());
    assertEquals(chicken, choices.get(0).sourceOptionId());
    assertNull(choices.get(1).label());
    assertEquals(new BigDecimal("2000.00"), choices.get(2).extraPrice());
    assertEquals(egg, choices.get(2).sourceAdditionId());
  }

  @Test
  void aPlateAloneIsAnOrderButNothingAtAllIsNot() {
    service.createOwnOrder(USER, KEY, order(List.of(), plate(List.of())));
    assertEquals(0, new BigDecimal("9500.00").compareTo(inserted().total()));
    verify(port).insertItems(any(), eq(CAFETERIA), eq(List.of()));
    assertEquals(
        "INVALID_ORDER_REQUEST",
        code(() -> service.createOwnOrder(USER, KEY, order(List.of(), null))));
  }

  @Test
  void thePlateIsOneUnitOfFifteenAndAdditionsAreNone() {
    var fourteen = List.of(new Line(JUICE, 10), new Line(UUID.randomUUID(), 4));
    when(port.lockProducts(eq(CAFETERIA), anyList()))
        .thenAnswer(
            call ->
                ((List<UUID>) call.getArgument(1))
                    .stream()
                        .map(id -> new LockedProduct(id, "P", new BigDecimal("1000.00"), true))
                        .toList());
    when(port.lockAvailableToday(eq(CAFETERIA), anyList(), eq(TODAY)))
        .thenAnswer(call -> Set.copyOf((List<UUID>) call.getArgument(1)));
    // 14 products + the plate = 15, with an addition on top: allowed.
    service.createOwnOrder(USER, KEY, order(fourteen, plate(List.of(egg))));
    var fifteen = List.of(new Line(JUICE, 10), new Line(UUID.randomUUID(), 5));
    assertEquals(
        "ORDER_LIMIT_EXCEEDED",
        code(() -> service.createOwnOrder(USER, KEY, order(fifteen, plate(List.of())))));
  }

  @Test
  void flagOffRefusesAMenuButNotAnOrderWithoutOne() {
    enabled = false;
    assertEquals(
        "DAILY_MENU_DISABLED",
        code(
            () ->
                service.createOwnOrder(
                    USER, KEY, order(List.of(new Line(JUICE, 1)), plate(List.of())))));
    verify(port, never()).insertOrder(any());
    service.createOwnOrder(USER, KEY, order(List.of(new Line(JUICE, 1)), null));
    verify(port).insertOrder(any());
    verify(port, never()).lockPublishedDailyMenu(any(), any());
  }

  @Test
  void anotherBusinessDateIsRefusedBeforeAnyLock() {
    var yesterday =
        new DailyMenuRequest(
            TODAY.minusDays(1),
            List.of(new Choice(PROTEIN, chicken, false), new Choice(SIDES, null, true)),
            List.of());
    assertEquals(
        "DAILY_MENU_DATE_CHANGED",
        code(() -> service.createOwnOrder(USER, KEY, order(List.of(), yesterday))));
    verify(port, never()).lockCafeteria(any(), any());
  }

  @Test
  void unpublishedOrIncompleteMenuCreatesNothing() {
    when(port.lockPublishedDailyMenu(CAFETERIA, TODAY)).thenReturn(Optional.empty());
    assertEquals(
        "DAILY_MENU_NOT_PUBLISHED",
        code(() -> service.createOwnOrder(USER, KEY, order(List.of(), plate(List.of())))));
    when(port.lockPublishedDailyMenu(CAFETERIA, TODAY))
        .thenReturn(Optional.of(new PublishedDailyMenu("Almuerzo", BigDecimal.TEN)));
    menus.options.clear();
    assertEquals(
        "DAILY_MENU_NOT_PUBLISHED",
        code(() -> service.createOwnOrder(USER, KEY, order(List.of(), plate(List.of())))));
    verify(port, never()).insertOrder(any());
  }

  @Test
  void everySingleCategoryNeedsExactlyOneValidChoice() {
    var cases =
        List.of(
            // Mandatory category skipped.
            List.of(new Choice(PROTEIN, null, true), new Choice(SIDES, null, true)),
            // A category left out.
            List.of(new Choice(PROTEIN, chicken, false)),
            // An option of another category.
            List.of(new Choice(PROTEIN, chicken, false), new Choice(SIDES, chicken, false)),
            // An option that is not today's.
            List.of(new Choice(PROTEIN, UUID.randomUUID(), false), new Choice(SIDES, null, true)),
            // A category that is not an active SINGLE one.
            List.of(
                new Choice(PROTEIN, chicken, false),
                new Choice(SIDES, null, true),
                new Choice(ClientDailyMenuServiceTest.EXTRAS, null, true)),
            // Repeated category.
            List.of(new Choice(PROTEIN, chicken, false), new Choice(PROTEIN, chicken, false)),
            // Option and «Ninguna» at once.
            List.of(new Choice(PROTEIN, chicken, true), new Choice(SIDES, null, true)));
    for (var choices : cases)
      assertEquals(
          "DAILY_MENU_SELECTION_INVALID",
          code(
              () ->
                  service.createOwnOrder(
                      USER,
                      KEY,
                      order(List.of(), new DailyMenuRequest(TODAY, choices, List.of())))),
          choices.toString());
    verify(port, never()).insertOrder(any());
  }

  @Test
  void additionsMustBeOnTodayAndNotRepeated() {
    assertEquals(
        "DAILY_MENU_ADDITION_UNAVAILABLE",
        code(
            () ->
                service.createOwnOrder(
                    USER, KEY, order(List.of(), plate(List.of(UUID.randomUUID()))))));
    assertEquals(
        "DAILY_MENU_SELECTION_INVALID",
        code(() -> service.createOwnOrder(USER, KEY, order(List.of(), plate(List.of(egg, egg))))));
    verify(port, never()).insertOrder(any());
  }

  @Test
  void theMenuIsPartOfTheIdempotencyHashButItsOrderIsNot() {
    var hashes = new ArrayList<String>();
    for (var request :
        List.of(
            order(List.of(new Line(JUICE, 1)), null),
            order(List.of(new Line(JUICE, 1)), plate(List.of())),
            order(
                List.of(new Line(JUICE, 1)),
                new DailyMenuRequest(
                    TODAY,
                    List.of(new Choice(SIDES, null, true), new Choice(PROTEIN, chicken, false)),
                    List.of())),
            order(List.of(new Line(JUICE, 1)), plate(List.of(egg))))) {
      reset(port);
      setUp();
      service.createOwnOrder(USER, KEY, request);
      hashes.add(inserted().requestHash());
    }
    assertNotEquals(hashes.get(0), hashes.get(1), "A menu changes the hash");
    assertEquals(hashes.get(1), hashes.get(2), "Choice order does not");
    assertNotEquals(hashes.get(1), hashes.get(3), "An addition does");
    // Without a menu the hash is B15's, so keys already stored keep matching.
    reset(port);
    setUp();
    var plain = new ClientOrderCreationService(port, () -> NOW, mockManager());
    plain.createOwnOrder(USER, KEY, new OrderRequest(CAFETERIA, List.of(new Line(JUICE, 1)), null));
    assertEquals(hashes.get(0), inserted().requestHash());
  }

  static PlatformTransactionManager mockManager() {
    var manager = mock(PlatformTransactionManager.class);
    when(manager.getTransaction(any())).thenAnswer(call -> new SimpleTransactionStatus());
    return manager;
  }

  @Test
  void aVanishedIngredientNeverTouchesOrdersAlreadyPlaced() {
    service.createOwnOrder(USER, KEY, order(List.of(), plate(List.of())));
    var copied = copied();
    // The worker removes the option afterwards: the order keeps its own copy.
    menus.options.clear();
    assertEquals("Pollo a la plancha", copied.get(0).label());
    verify(port, times(1)).insertDailyMenu(any(), any(), any(), any(), any());
  }

  @Test
  void theServiceFeeIsAddedOnTopOfPlateProductsAndAdditions() {
    var manager = mock(PlatformTransactionManager.class);
    when(manager.getTransaction(any())).thenAnswer(call -> new SimpleTransactionStatus());
    var fees = mock(com.santotofood.application.port.out.ServiceFeeQueryPort.class);
    when(fees.lockEffectiveFee(CAFETERIA)).thenReturn(300);
    var withFee =
        new ClientOrderCreationService(
            port, () -> NOW, manager, event -> {}, () -> enabled, menus, () -> true, fees);
    withFee.createOwnOrder(
        USER,
        KEY,
        new OrderRequest(
            CAFETERIA, List.of(new Line(JUICE, 2)), null, null, plate(List.of(egg)), 300));
    // 2 x 4500 + 9500 + 2000 + 300 of service fee.
    assertEquals(0, new BigDecimal("20800.00").compareTo(inserted().total()));
    assertEquals(300, inserted().serviceFeeCop());
  }
}

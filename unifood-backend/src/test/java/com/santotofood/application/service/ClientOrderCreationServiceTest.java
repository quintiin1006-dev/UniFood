package com.santotofood.application.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

import com.santotofood.application.exception.ClientProfileNotFoundException;
import com.santotofood.application.port.in.CreateOwnOrderUseCase.OrderLine;
import com.santotofood.domain.exception.InvalidOrderRequestException;
import com.santotofood.domain.exception.OrderUnavailableException;
import com.santotofood.domain.model.CatalogCategory;
import com.santotofood.domain.model.Client;
import com.santotofood.domain.model.Lunch;
import com.santotofood.domain.model.Order;
import com.santotofood.domain.model.OrderItem;
import com.santotofood.domain.model.OrderStatus;
import com.santotofood.domain.port.out.ClientRepository;
import com.santotofood.domain.port.out.LunchRepository;
import com.santotofood.domain.port.out.OrderItemRepository;
import com.santotofood.domain.port.out.OrderRepository;
import com.santotofood.domain.port.out.TimeProvider;
import com.santotofood.shared.error.ErrorCode;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class ClientOrderCreationServiceTest {

  final ClientRepository clients = mock(ClientRepository.class);
  final LunchRepository lunches = mock(LunchRepository.class);
  final OrderRepository orders = mock(OrderRepository.class);
  final OrderItemRepository items = mock(OrderItemRepository.class);
  final TimeProvider clock = mock(TimeProvider.class);
  final ClientOrderCreationService service =
      new ClientOrderCreationService(clients, lunches, orders, items, clock);

  final Instant now = Instant.parse("2026-11-03T12:00:00Z");
  final UUID userId = UUID.randomUUID();
  final UUID cafeteriaId = UUID.randomUUID();
  final Client client =
      Client.reconstitute(
          UUID.randomUUID(),
          userId,
          UUID.randomUUID(),
          "Ana Estudiante",
          "1000000001",
          null,
          now,
          now);

  final UUID eggsId = UUID.randomUUID();
  final UUID brothId = UUID.randomUUID();

  @BeforeEach
  void setup() {
    when(clients.findByUserId(userId)).thenReturn(Optional.of(client));
    when(clock.now()).thenReturn(now);
    when(orders.save(any(Order.class))).thenAnswer(invocation -> invocation.getArgument(0));
    when(items.save(any(OrderItem.class))).thenAnswer(invocation -> invocation.getArgument(0));
    when(lunches.decreaseStock(any(), anyInt())).thenReturn(true);
  }

  Lunch lunch(UUID id, UUID cafeteria, String name, String price, int stock, boolean active) {
    return Lunch.reconstitute(
        id,
        cafeteria,
        name,
        null,
        new BigDecimal(price),
        null,
        stock,
        active,
        CatalogCategory.CORRIENTE);
  }

  void catalog(Lunch... available) {
    when(lunches.findAllByIds(any())).thenReturn(List.of(available));
  }

  @Test
  void validCartBecomesPendingOrderWithPricesFromTheDatabase() {
    catalog(
        lunch(eggsId, cafeteriaId, "Huevos con arepa", "10000", 5, true),
        lunch(brothId, cafeteriaId, "Caldo", "7000", 5, true));

    Order order =
        service.createOwnOrder(
            userId,
            List.of(new OrderLine(eggsId, 2, "  sin cebolla  "), new OrderLine(brothId, 1, "   ")));

    assertEquals(OrderStatus.PENDING, order.getStatus());
    assertEquals(cafeteriaId, order.getCafeteriaId());
    assertEquals(client.getId(), order.getClientId());
    assertEquals("Ana Estudiante", order.getClientName());
    assertEquals("1000000001", order.getClientDocument());
    assertEquals(0, new BigDecimal("27000").compareTo(order.getTotal()));
    assertEquals(now, order.getCreatedAt());
    assertNull(order.getCancellationDeadline());

    assertEquals(2, order.getItems().size());
    OrderItem first = order.getItems().getFirst();
    assertEquals(eggsId, first.getLunchId());
    assertEquals(2, first.getQuantity());
    assertEquals("sin cebolla", first.getNote());
    assertEquals(0, new BigDecimal("20000").compareTo(first.getSubtotal()));
    assertNull(order.getItems().get(1).getNote());

    verify(lunches).decreaseStock(eggsId, 2);
    verify(lunches).decreaseStock(brothId, 1);
    verify(orders).save(order);
    verify(items, times(2)).save(any(OrderItem.class));
  }

  @Test
  void emptyCartIsRejectedBeforeAnyWrite() {
    InvalidOrderRequestException error =
        assertThrows(
            InvalidOrderRequestException.class, () -> service.createOwnOrder(userId, List.of()));

    assertEquals(ErrorCode.EMPTY_ORDER, error.getCode());
    verifyNoInteractions(clients, lunches, orders, items);
  }

  @Test
  void nonPositiveQuantityIsRejected() {
    InvalidOrderRequestException error =
        assertThrows(
            InvalidOrderRequestException.class,
            () -> service.createOwnOrder(userId, List.of(new OrderLine(eggsId, 0, null))));

    assertEquals(ErrorCode.INVALID_ORDER_LINE, error.getCode());
    verifyNoInteractions(lunches, orders);
  }

  @Test
  void orderAboveThreePlatesIsRejectedButExactlyThreeIsAccepted() {
    catalog(lunch(eggsId, cafeteriaId, "Huevos", "10000", 9, true));

    InvalidOrderRequestException error =
        assertThrows(
            InvalidOrderRequestException.class,
            () -> service.createOwnOrder(userId, List.of(new OrderLine(eggsId, 4, null))));
    assertEquals(ErrorCode.ORDER_LIMIT_EXCEEDED, error.getCode());
    verify(lunches, never()).decreaseStock(any(), anyInt());

    Order accepted =
        service.createOwnOrder(
            userId, List.of(new OrderLine(eggsId, 2, null), new OrderLine(eggsId, 1, "con pan")));
    assertEquals(0, new BigDecimal("30000").compareTo(accepted.getTotal()));
  }

  @Test
  void noteLongerThanTwoHundredCharactersIsRejected() {
    InvalidOrderRequestException error =
        assertThrows(
            InvalidOrderRequestException.class,
            () ->
                service.createOwnOrder(userId, List.of(new OrderLine(eggsId, 1, "x".repeat(201)))));

    assertEquals(ErrorCode.ORDER_NOTE_TOO_LONG, error.getCode());
    verifyNoInteractions(lunches, orders);
  }

  @Test
  void accountWithoutClientProfileCannotOrder() {
    when(clients.findByUserId(userId)).thenReturn(Optional.empty());

    assertThrows(
        ClientProfileNotFoundException.class,
        () -> service.createOwnOrder(userId, List.of(new OrderLine(eggsId, 1, null))));

    verifyNoInteractions(lunches, orders, items);
  }

  @Test
  void missingLunchIsUnavailableAndNothingIsDecremented() {
    catalog(lunch(eggsId, cafeteriaId, "Huevos", "10000", 5, true));

    OrderUnavailableException error =
        assertThrows(
            OrderUnavailableException.class,
            () ->
                service.createOwnOrder(
                    userId,
                    List.of(new OrderLine(eggsId, 1, null), new OrderLine(brothId, 1, null))));

    assertEquals(ErrorCode.LUNCH_UNAVAILABLE, error.getCode());
    verify(lunches, never()).decreaseStock(any(), anyInt());
    verify(orders, never()).save(any());
  }

  @Test
  void inactiveLunchIsUnavailable() {
    catalog(lunch(eggsId, cafeteriaId, "Huevos", "10000", 5, false));

    OrderUnavailableException error =
        assertThrows(
            OrderUnavailableException.class,
            () -> service.createOwnOrder(userId, List.of(new OrderLine(eggsId, 1, null))));

    assertEquals(ErrorCode.LUNCH_UNAVAILABLE, error.getCode());
    verify(orders, never()).save(any());
  }

  @Test
  void lunchesFromTwoCafeteriasCannotShareAnOrder() {
    UUID otherCafeteria = UUID.randomUUID();
    catalog(
        lunch(eggsId, cafeteriaId, "Huevos", "10000", 5, true),
        lunch(brothId, otherCafeteria, "Caldo", "7000", 5, true));

    InvalidOrderRequestException error =
        assertThrows(
            InvalidOrderRequestException.class,
            () ->
                service.createOwnOrder(
                    userId,
                    List.of(new OrderLine(eggsId, 1, null), new OrderLine(brothId, 1, null))));

    assertEquals(ErrorCode.MIXED_CAFETERIA_ORDER, error.getCode());
    verify(lunches, never()).decreaseStock(any(), anyInt());
    verify(orders, never()).save(any());
  }

  @Test
  void stockFailureStopsTheOrderSoTheTransactionCanRollBackEarlierDecrements() {
    catalog(
        lunch(eggsId, cafeteriaId, "Huevos", "10000", 5, true),
        lunch(brothId, cafeteriaId, "Caldo", "7000", 0, true));
    when(lunches.decreaseStock(brothId, 1)).thenReturn(false);

    OrderUnavailableException error =
        assertThrows(
            OrderUnavailableException.class,
            () ->
                service.createOwnOrder(
                    userId,
                    List.of(new OrderLine(eggsId, 1, null), new OrderLine(brothId, 1, null))));

    assertEquals(ErrorCode.INSUFFICIENT_STOCK, error.getCode());
    verify(lunches).decreaseStock(eggsId, 1);
    verify(orders, never()).save(any());
    verify(items, never()).save(any());
  }
}

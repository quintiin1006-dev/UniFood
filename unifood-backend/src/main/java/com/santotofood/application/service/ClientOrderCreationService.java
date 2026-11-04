package com.santotofood.application.service;

import com.santotofood.application.exception.ClientProfileNotFoundException;
import com.santotofood.application.port.in.CreateOwnOrderUseCase;
import com.santotofood.domain.exception.InvalidOrderRequestException;
import com.santotofood.domain.exception.OrderUnavailableException;
import com.santotofood.domain.model.Client;
import com.santotofood.domain.model.Lunch;
import com.santotofood.domain.model.Order;
import com.santotofood.domain.model.OrderItem;
import com.santotofood.domain.port.out.ClientRepository;
import com.santotofood.domain.port.out.LunchRepository;
import com.santotofood.domain.port.out.OrderItemRepository;
import com.santotofood.domain.port.out.OrderRepository;
import com.santotofood.domain.port.out.TimeProvider;
import com.santotofood.shared.error.ErrorCode;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * HU-06: converts a client's cart into a PENDING order. Business rules run here, against fresh
 * database state, so a stale or tampered browser cart cannot change prices, cafeteria or stock.
 */
@Service
public class ClientOrderCreationService implements CreateOwnOrderUseCase {

  /** Matches the three-plate limit enforced in the client cart. */
  public static final int MAX_PLATES_PER_ORDER = 3;

  public static final int MAX_NOTE_LENGTH = 200;

  private final ClientRepository clients;
  private final LunchRepository lunches;
  private final OrderRepository orders;
  private final OrderItemRepository items;
  private final TimeProvider clock;

  public ClientOrderCreationService(
      ClientRepository clients,
      LunchRepository lunches,
      OrderRepository orders,
      OrderItemRepository items,
      TimeProvider clock) {
    this.clients = clients;
    this.lunches = lunches;
    this.orders = orders;
    this.items = items;
    this.clock = clock;
  }

  @Override
  @Transactional
  public Order createOwnOrder(UUID userId, List<OrderLine> lines) {
    List<OrderLine> cart = validateShape(lines);

    Client client = clients.findByUserId(userId).orElseThrow(ClientProfileNotFoundException::new);

    Map<UUID, Lunch> lunchesById = loadActiveLunches(cart);

    UUID cafeteriaId = singleCafeteria(lunchesById.values());

    UUID orderId = UUID.randomUUID();
    List<OrderItem> orderItems = new ArrayList<>();
    BigDecimal total = BigDecimal.ZERO;

    // A failed decrement throws, which rolls back every decrement already made in this transaction.
    for (OrderLine line : cart) {
      Lunch lunch = lunchesById.get(line.lunchId());

      if (!lunches.decreaseStock(lunch.getId(), line.quantity())) {
        throw new OrderUnavailableException(
            ErrorCode.INSUFFICIENT_STOCK,
            "No hay suficientes unidades disponibles de " + lunch.getName());
      }

      OrderItem item =
          new OrderItem(
              UUID.randomUUID(),
              orderId,
              lunch.getId(),
              lunch.getName(),
              lunch.getPrice(),
              line.quantity(),
              null,
              normalizeNote(line.note()));

      total = total.add(item.getSubtotal());
      orderItems.add(item);
    }

    Order order =
        new Order(
            orderId,
            cafeteriaId,
            client.getId(),
            client.getFullName(),
            client.getDocument(),
            total,
            null,
            clock.now());

    Order savedOrder = orders.save(order);

    List<OrderItem> savedItems = new ArrayList<>();
    for (OrderItem item : orderItems) {
      savedItems.add(items.save(item));
    }

    savedOrder.setItems(savedItems);
    return savedOrder;
  }

  private static List<OrderLine> validateShape(List<OrderLine> lines) {
    if (lines == null || lines.isEmpty()) {
      throw new InvalidOrderRequestException(
          ErrorCode.EMPTY_ORDER, "El carrito está vacío; agrega al menos un plato");
    }

    int plates = 0;

    for (OrderLine line : lines) {
      if (line == null || line.lunchId() == null) {
        throw new InvalidOrderRequestException(
            ErrorCode.INVALID_ORDER_LINE, "Cada línea del pedido debe indicar un plato");
      }

      if (line.quantity() < 1) {
        throw new InvalidOrderRequestException(
            ErrorCode.INVALID_ORDER_LINE, "La cantidad debe ser mayor que cero");
      }

      if (line.note() != null && line.note().trim().length() > MAX_NOTE_LENGTH) {
        throw new InvalidOrderRequestException(
            ErrorCode.ORDER_NOTE_TOO_LONG,
            "Las observaciones no pueden superar " + MAX_NOTE_LENGTH + " caracteres");
      }

      plates += line.quantity();
    }

    if (plates > MAX_PLATES_PER_ORDER) {
      throw new InvalidOrderRequestException(
          ErrorCode.ORDER_LIMIT_EXCEEDED,
          "Un pedido admite como máximo " + MAX_PLATES_PER_ORDER + " platos completos");
    }

    return lines;
  }

  private Map<UUID, Lunch> loadActiveLunches(List<OrderLine> cart) {
    List<UUID> requestedIds = cart.stream().map(OrderLine::lunchId).distinct().toList();

    Map<UUID, Lunch> found =
        lunches.findAllByIds(requestedIds).stream()
            .collect(Collectors.toMap(Lunch::getId, Function.identity()));

    for (UUID lunchId : requestedIds) {
      Lunch lunch = found.get(lunchId);
      if (lunch == null || !lunch.isActive()) {
        throw new OrderUnavailableException(
            ErrorCode.LUNCH_UNAVAILABLE,
            "Uno de los platos ya no está disponible; actualiza tu carrito");
      }
    }

    return found;
  }

  private static UUID singleCafeteria(Collection<Lunch> selected) {
    List<UUID> cafeterias = selected.stream().map(Lunch::getCafeteriaId).distinct().toList();

    if (cafeterias.size() != 1) {
      throw new InvalidOrderRequestException(
          ErrorCode.MIXED_CAFETERIA_ORDER,
          "Un pedido solo puede incluir platos de una misma cafetería");
    }

    return cafeterias.getFirst();
  }

  private static String normalizeNote(String note) {
    if (note == null) {
      return null;
    }
    String trimmed = note.trim();
    return trimmed.isEmpty() ? null : trimmed;
  }
}

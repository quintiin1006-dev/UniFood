package com.santotofood.adapter.in.web;

import com.santotofood.adapter.in.web.dto.OrderResponse;
import com.santotofood.adapter.in.web.dto.RejectOrderRequest;
import com.santotofood.adapter.in.web.mapper.OrderResponseMapper;
import com.santotofood.application.port.in.CallStudentUseCase;
import com.santotofood.application.port.in.DeliverOrderUseCase;
import com.santotofood.application.port.in.GetOrderDailyMenusUseCase;
import com.santotofood.application.port.in.GetOrdersByCafeteriaUseCase;
import com.santotofood.application.port.in.MarkOrderNotCollectedUseCase;
import com.santotofood.application.port.in.MarkOrderReadyUseCase;
import com.santotofood.application.port.in.PrepareOrderUseCase;
import com.santotofood.application.port.in.RejectOrderUseCase;
import com.santotofood.application.port.in.RemindStudentUseCase;
import com.santotofood.config.OrderAuthorization;
import com.santotofood.domain.model.Order;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/orders")
@RequiredArgsConstructor
public class OrderController {

  private final PrepareOrderUseCase prepareOrderUseCase;
  private final MarkOrderReadyUseCase markOrderReadyUseCase;
  private final CallStudentUseCase callStudentUseCase;
  private final RemindStudentUseCase remindStudentUseCase;
  private final DeliverOrderUseCase deliverOrderUseCase;
  private final MarkOrderNotCollectedUseCase markOrderNotCollectedUseCase;
  private final GetOrdersByCafeteriaUseCase getOrdersByCafeteriaUseCase;
  private final RejectOrderUseCase rejectOrderUseCase;
  private final OrderResponseMapper orderResponseMapper;
  private final OrderAuthorization orderAuthorization;
  // Optional: contexts without the daily menu module still build; orders then carry none.
  private final Optional<GetOrderDailyMenusUseCase> dailyMenus;

  @GetMapping
  @PreAuthorize("@orderAuthorization.cafeteria(authentication, #cafeteriaId)")
  public ResponseEntity<List<OrderResponse>> getOrdersByCafeteria(@RequestParam UUID cafeteriaId) {

    var listing = getOrdersByCafeteriaUseCase.getOperationalOrders(cafeteriaId);
    // One read for the whole listing, never one per order.
    var menus = menus(listing.orders().stream().map(Order::getId).toList());
    List<OrderResponse> response =
        listing.orders().stream()
            .map(
                order ->
                    order.getId() != null && menus.containsKey(order.getId())
                        ? orderResponseMapper.toResponse(order, menus.get(order.getId()))
                        : orderResponseMapper.toResponse(order))
            .toList();

    return ResponseEntity.ok()
        .header("Cache-Control", "no-store")
        .header("X-Business-Date", listing.businessDate().value().toString())
        .header("X-Next-Business-Date-At", listing.businessDate().nextDayStartInstant().toString())
        .body(response);
  }

  @PatchMapping("/{orderId}/prepare")
  @PreAuthorize("@orderAuthorization.order(authentication, #orderId)")
  public ResponseEntity<OrderResponse> prepareOrder(@PathVariable UUID orderId) {

    Order updatedOrder = prepareOrderUseCase.prepareOrder(orderId);

    return ResponseEntity.ok(respond(updatedOrder));
  }

  @PatchMapping("/{orderId}/ready")
  @PreAuthorize("@orderAuthorization.order(authentication, #orderId)")
  public ResponseEntity<OrderResponse> markOrderReady(@PathVariable UUID orderId) {

    Order updatedOrder = markOrderReadyUseCase.markOrderReady(orderId);

    return ResponseEntity.ok(respond(updatedOrder));
  }

  @PatchMapping("/{orderId}/call")
  @PreAuthorize("@orderAuthorization.order(authentication, #orderId)")
  public ResponseEntity<OrderResponse> callStudent(@PathVariable UUID orderId) {

    Order updatedOrder = callStudentUseCase.callStudent(orderId);

    return ResponseEntity.ok(respond(updatedOrder));
  }

  /**
   * CALLED only, at most Order.MAX_REMINDERS reminders and 5 minutes after the call or the previous
   * reminder.
   */
  @PatchMapping("/{orderId}/remind")
  @PreAuthorize("@orderAuthorization.order(authentication, #orderId)")
  public ResponseEntity<OrderResponse> remindStudent(@PathVariable UUID orderId) {

    Order updatedOrder = remindStudentUseCase.remindStudent(orderId);

    return ResponseEntity.ok(respond(updatedOrder));
  }

  @PatchMapping("/{orderId}/deliver")
  @PreAuthorize("@orderAuthorization.order(authentication, #orderId)")
  public ResponseEntity<OrderResponse> deliverOrder(@PathVariable UUID orderId) {

    Order updatedOrder = deliverOrderUseCase.deliverOrder(orderId);

    return ResponseEntity.ok(respond(updatedOrder));
  }

  /**
   * CALLED with every reminder (Order.MAX_REMINDERS) sent; NOT_COLLECTED is terminal, so repeating
   * it is a 409.
   */
  @PatchMapping("/{orderId}/not-collected")
  @PreAuthorize("@orderAuthorization.order(authentication, #orderId)")
  public ResponseEntity<OrderResponse> markOrderNotCollected(@PathVariable UUID orderId) {

    Order updatedOrder = markOrderNotCollectedUseCase.markOrderNotCollected(orderId);

    return ResponseEntity.ok(respond(updatedOrder));
  }

  /**
   * B18: PENDING or PREPARING only, with a reason the client sees. The worker who rejects comes
   * from the verified JWT; another cafeteria's order and a missing one get the same 403.
   */
  @PatchMapping("/{orderId}/reject")
  @PreAuthorize("@orderAuthorization.order(authentication, #orderId)")
  public ResponseEntity<OrderResponse> rejectOrder(
      Authentication authentication,
      @PathVariable UUID orderId,
      @RequestBody(required = false) RejectOrderRequest request) {
    UUID workerId =
        orderAuthorization
            .authenticatedUser(authentication)
            .orElseThrow(() -> new AccessDeniedException("Worker identity unavailable"));
    Order updatedOrder =
        rejectOrderUseCase.rejectOrder(
            orderId, workerId, request == null ? null : request.reason());
    return ResponseEntity.ok(respond(updatedOrder));
  }

  /** Without a menu (or without an order, as in tests), exactly the response of before. */
  private OrderResponse respond(Order order) {
    var menu = order == null ? null : menus(List.of(order.getId())).get(order.getId());
    return menu == null
        ? orderResponseMapper.toResponse(order)
        : orderResponseMapper.toResponse(order, menu);
  }

  private Map<UUID, com.santotofood.application.model.OrderDailyMenu> menus(List<UUID> ids) {
    return dailyMenus.map(use -> use.getDailyMenus(ids)).orElse(Map.of());
  }
}

package com.santotofood.adapter.in.web;

import com.santotofood.adapter.in.web.dto.OrderResponse;
import com.santotofood.adapter.in.web.mapper.OrderResponseMapper;
import com.santotofood.application.port.in.GetOrderDailyMenusUseCase;
import com.santotofood.application.port.in.GetOrdersByCafeteriaUseCase;
import com.santotofood.config.OrderAuthorization;
import com.santotofood.domain.model.Order;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * The worker's operational listing in a single call: the cafeteria comes from the authorization
 * facts read from the database in this same request, never from a parameter, so the BFF no longer
 * asks for {@code /api/worker/context} first. Same body and headers as {@code GET /api/orders}.
 * Each order carries its daily menu copy, read once for the whole listing.
 */
@RestController
public class WorkerOrdersController {
  private final OrderAuthorization orderAuthorization;
  private final GetOrdersByCafeteriaUseCase getOrdersByCafeteriaUseCase;
  private final OrderResponseMapper orderResponseMapper;
  private final Optional<GetOrderDailyMenusUseCase> dailyMenus;

  public WorkerOrdersController(
      OrderAuthorization orderAuthorization,
      GetOrdersByCafeteriaUseCase getOrdersByCafeteriaUseCase,
      OrderResponseMapper orderResponseMapper) {
    this(orderAuthorization, getOrdersByCafeteriaUseCase, orderResponseMapper, Optional.empty());
  }

  /** Optional: contexts without the daily menu module still build; orders then carry none. */
  @Autowired
  public WorkerOrdersController(
      OrderAuthorization orderAuthorization,
      GetOrdersByCafeteriaUseCase getOrdersByCafeteriaUseCase,
      OrderResponseMapper orderResponseMapper,
      Optional<GetOrderDailyMenusUseCase> dailyMenus) {
    this.orderAuthorization = orderAuthorization;
    this.getOrdersByCafeteriaUseCase = getOrdersByCafeteriaUseCase;
    this.orderResponseMapper = orderResponseMapper;
    this.dailyMenus = dailyMenus;
  }

  @GetMapping("/api/worker/orders")
  @PreAuthorize("isAuthenticated()")
  public ResponseEntity<List<OrderResponse>> orders(Authentication authentication) {
    var cafeteriaId =
        orderAuthorization
            .workerCafeteria(authentication)
            .orElseThrow(() -> new AccessDeniedException("Worker orders unavailable"));
    var listing = getOrdersByCafeteriaUseCase.getOperationalOrders(cafeteriaId);
    var menus =
        dailyMenus
            .map(use -> use.getDailyMenus(listing.orders().stream().map(Order::getId).toList()))
            .orElse(Map.of());
    return ResponseEntity.ok()
        .header("Cache-Control", "no-store")
        .header("X-Business-Date", listing.businessDate().value().toString())
        .header("X-Next-Business-Date-At", listing.businessDate().nextDayStartInstant().toString())
        .body(
            listing.orders().stream()
                .map(
                    order -> {
                      var menu = order.getId() == null ? null : menus.get(order.getId());
                      // Without a menu, exactly the response of before.
                      return menu == null
                          ? orderResponseMapper.toResponse(order)
                          : orderResponseMapper.toResponse(order, menu);
                    })
                .toList());
  }
}

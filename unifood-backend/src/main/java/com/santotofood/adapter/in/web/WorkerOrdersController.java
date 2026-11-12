package com.santotofood.adapter.in.web;

import com.santotofood.adapter.in.web.dto.OrderResponse;
import com.santotofood.adapter.in.web.mapper.OrderResponseMapper;
import com.santotofood.application.port.in.GetOrdersByCafeteriaUseCase;
import com.santotofood.config.OrderAuthorization;
import java.util.List;
import lombok.RequiredArgsConstructor;
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
 */
@RestController
@RequiredArgsConstructor
public class WorkerOrdersController {
  private final OrderAuthorization orderAuthorization;
  private final GetOrdersByCafeteriaUseCase getOrdersByCafeteriaUseCase;
  private final OrderResponseMapper orderResponseMapper;

  @GetMapping("/api/worker/orders")
  @PreAuthorize("isAuthenticated()")
  public ResponseEntity<List<OrderResponse>> orders(Authentication authentication) {
    var cafeteriaId =
        orderAuthorization
            .workerCafeteria(authentication)
            .orElseThrow(() -> new AccessDeniedException("Worker orders unavailable"));
    var listing = getOrdersByCafeteriaUseCase.getOperationalOrders(cafeteriaId);
    return ResponseEntity.ok()
        .header("Cache-Control", "no-store")
        .header("X-Business-Date", listing.businessDate().value().toString())
        .header("X-Next-Business-Date-At", listing.businessDate().nextDayStartInstant().toString())
        .body(listing.orders().stream().map(orderResponseMapper::toResponse).toList());
  }
}

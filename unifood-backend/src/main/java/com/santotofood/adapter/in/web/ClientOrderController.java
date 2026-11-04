package com.santotofood.adapter.in.web;

import com.santotofood.adapter.in.web.dto.CreateOrderRequest;
import com.santotofood.adapter.in.web.dto.OrderLineRequest;
import com.santotofood.adapter.in.web.dto.OrderResponse;
import com.santotofood.adapter.in.web.mapper.OrderResponseMapper;
import com.santotofood.application.port.in.CancelOrderUseCase;
import com.santotofood.application.port.in.CreateOwnOrderUseCase;
import com.santotofood.application.port.in.CreateOwnOrderUseCase.OrderLine;
import com.santotofood.config.OrderAuthorization;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/me/orders")
@RequiredArgsConstructor
public class ClientOrderController {
  private final CancelOrderUseCase cancelOrderUseCase;
  private final CreateOwnOrderUseCase createOwnOrderUseCase;
  private final OrderResponseMapper orderResponseMapper;
  private final OrderAuthorization orderAuthorization;

  @PostMapping
  @ResponseStatus(HttpStatus.CREATED)
  @PreAuthorize("@orderAuthorization.client(authentication)")
  public OrderResponse createOwnOrder(
      Authentication authentication, @Valid @RequestBody CreateOrderRequest request) {
    UUID userId =
        orderAuthorization
            .authenticatedUser(authentication)
            .orElseThrow(() -> new AccessDeniedException("Cuenta no autenticada"));
    List<OrderLine> lines = request.items().stream().map(ClientOrderController::toLine).toList();
    return orderResponseMapper.toResponse(createOwnOrderUseCase.createOwnOrder(userId, lines));
  }

  @PatchMapping("/{orderId}/cancel")
  @PreAuthorize("@orderAuthorization.clientOrder(authentication, #orderId)")
  public OrderResponse cancelOwnOrder(@PathVariable UUID orderId) {
    return orderResponseMapper.toResponse(cancelOrderUseCase.cancelOwnOrder(orderId));
  }

  private static OrderLine toLine(OrderLineRequest line) {
    return new OrderLine(line.lunchId(), line.quantity(), line.note());
  }
}

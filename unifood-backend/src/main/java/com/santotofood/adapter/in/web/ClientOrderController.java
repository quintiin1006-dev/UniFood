package com.santotofood.adapter.in.web;

import com.santotofood.adapter.in.web.dto.OrderResponse;
import com.santotofood.adapter.in.web.mapper.OrderResponseMapper;
import com.santotofood.application.port.in.CancelOrderUseCase;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/me/orders")
@RequiredArgsConstructor
public class ClientOrderController {
  private final CancelOrderUseCase cancelOrderUseCase;
  private final OrderResponseMapper orderResponseMapper;

  @PatchMapping("/{orderId}/cancel")
  @PreAuthorize("@orderAuthorization.clientOrder(authentication, #orderId)")
  public OrderResponse cancelOwnOrder(@PathVariable UUID orderId) {
    return orderResponseMapper.toResponse(cancelOrderUseCase.cancelOwnOrder(orderId));
  }
}

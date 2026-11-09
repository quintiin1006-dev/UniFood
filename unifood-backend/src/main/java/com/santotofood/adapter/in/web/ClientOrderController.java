package com.santotofood.adapter.in.web;

import com.santotofood.adapter.in.web.dto.ClientOrderRequests;
import com.santotofood.adapter.in.web.dto.ClientOrderResponse;
import com.santotofood.adapter.in.web.dto.OrderResponse;
import com.santotofood.adapter.in.web.mapper.OrderResponseMapper;
import com.santotofood.application.port.in.CancelOrderUseCase;
import com.santotofood.application.port.in.CreateOwnOrderUseCase;
import com.santotofood.config.OrderAuthorization;
import jakarta.servlet.http.HttpServletRequest;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/me/orders")
@RequiredArgsConstructor
public class ClientOrderController {
  private final CancelOrderUseCase cancelOrderUseCase;
  private final CreateOwnOrderUseCase createOwnOrderUseCase;
  private final OrderResponseMapper orderResponseMapper;
  private final OrderAuthorization orderAuthorization;

  /** B15: 201 for a new order, 200 when the same request repeats its Idempotency-Key. */
  @PostMapping
  @PreAuthorize("@orderAuthorization.client(authentication)")
  public ResponseEntity<ClientOrderResponse> createOwnOrder(
      Authentication authentication,
      @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey,
      HttpServletRequest request) {
    UUID userId =
        orderAuthorization
            .authenticatedUser(authentication)
            .orElseThrow(() -> new AccessDeniedException("Client identity unavailable"));
    var result =
        createOwnOrderUseCase.createOwnOrder(
            userId, idempotencyKey, ClientOrderRequests.read(request));
    return ResponseEntity.status(result.created() ? HttpStatus.CREATED : HttpStatus.OK)
        .cacheControl(CacheControl.noStore())
        .body(ClientOrderResponse.from(result.order()));
  }

  @PatchMapping("/{orderId}/cancel")
  @PreAuthorize("@orderAuthorization.clientOrder(authentication, #orderId)")
  public OrderResponse cancelOwnOrder(@PathVariable UUID orderId) {
    return orderResponseMapper.toResponse(cancelOrderUseCase.cancelOwnOrder(orderId));
  }
}

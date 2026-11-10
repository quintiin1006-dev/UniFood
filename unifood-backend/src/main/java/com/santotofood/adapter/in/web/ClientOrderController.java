package com.santotofood.adapter.in.web;

import com.santotofood.adapter.in.web.dto.ClientOrderHistoryResponse;
import com.santotofood.adapter.in.web.dto.ClientOrderRequests;
import com.santotofood.adapter.in.web.dto.ClientOrderResponse;
import com.santotofood.application.exception.ClientOrderException;
import com.santotofood.application.port.in.CancelOrderUseCase;
import com.santotofood.application.port.in.CreateOwnOrderUseCase;
import com.santotofood.application.port.in.GetOwnCurrentOrderUseCase;
import com.santotofood.application.port.in.GetOwnOrderHistoryUseCase;
import com.santotofood.application.port.in.GetOwnOrderUseCase;
import com.santotofood.config.OrderAuthorization;
import jakarta.servlet.http.HttpServletRequest;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/me/orders")
@RequiredArgsConstructor
public class ClientOrderController {
  // Polled every few seconds: always revalidated, and only ever stored privately.
  private static final CacheControl POLLED = CacheControl.noCache().cachePrivate();
  private final CancelOrderUseCase cancelOrderUseCase;
  private final CreateOwnOrderUseCase createOwnOrderUseCase;
  private final GetOwnCurrentOrderUseCase currentOrders;
  private final GetOwnOrderHistoryUseCase histories;
  private final GetOwnOrderUseCase ownOrders;
  private final OrderAuthorization orderAuthorization;

  /** B15: 201 for a new order, 200 when the same request repeats its Idempotency-Key. */
  @PostMapping
  @PreAuthorize("@orderAuthorization.client(authentication)")
  public ResponseEntity<ClientOrderResponse> createOwnOrder(
      Authentication authentication,
      @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey,
      HttpServletRequest request) {
    var result =
        createOwnOrderUseCase.createOwnOrder(
            user(authentication), idempotencyKey, ClientOrderRequests.read(request));
    return ResponseEntity.status(result.created() ? HttpStatus.CREATED : HttpStatus.OK)
        .cacheControl(CacheControl.noStore())
        .body(ClientOrderResponse.from(result.order()));
  }

  /** B16: the active order or JSON {@code null}; 304 when If-None-Match still holds. */
  @GetMapping("/current")
  @PreAuthorize("@orderAuthorization.client(authentication)")
  public ResponseEntity<?> currentOrder(
      Authentication authentication,
      @RequestHeader(value = HttpHeaders.IF_NONE_MATCH, required = false) String ifNoneMatch) {
    var current = currentOrders.getOwnCurrentOrder(user(authentication), ifNoneMatch);
    if (current.notModified())
      return ResponseEntity.status(HttpStatus.NOT_MODIFIED)
          .eTag(current.etag())
          .cacheControl(POLLED)
          .build();
    var response = ResponseEntity.ok().eTag(current.etag()).cacheControl(POLLED);
    if (current.order().isEmpty())
      return response.contentType(MediaType.APPLICATION_JSON).body("null");
    return response.body(ClientOrderResponse.from(current.order().get()));
  }

  @GetMapping
  @PreAuthorize("@orderAuthorization.client(authentication)")
  public ResponseEntity<ClientOrderHistoryResponse> history(
      Authentication authentication,
      @RequestParam(required = false) String cursor,
      @RequestParam(required = false) String limit) {
    return ResponseEntity.ok()
        .cacheControl(CacheControl.noStore())
        .body(
            ClientOrderHistoryResponse.from(
                histories.getOwnOrderHistory(user(authentication), cursor, limit)));
  }

  /** A malformed id cannot name an order of this client, so it is the same 404. */
  @GetMapping("/{orderId}")
  @PreAuthorize("@orderAuthorization.client(authentication)")
  public ResponseEntity<ClientOrderResponse> ownOrder(
      Authentication authentication, @PathVariable String orderId) {
    UUID id;
    try {
      id = UUID.fromString(orderId);
    } catch (IllegalArgumentException malformed) {
      throw ClientOrderException.orderNotFound();
    }
    if (!id.toString().equalsIgnoreCase(orderId)) throw ClientOrderException.orderNotFound();
    return ResponseEntity.ok()
        .cacheControl(CacheControl.noStore())
        .body(ClientOrderResponse.from(ownOrders.getOwnOrder(user(authentication), id)));
  }

  /** PENDING only; repeating a client cancellation answers 200 with the same order. */
  @PatchMapping("/{orderId}/cancel")
  @PreAuthorize("@orderAuthorization.clientOrder(authentication, #orderId)")
  public ResponseEntity<ClientOrderResponse> cancelOwnOrder(
      Authentication authentication, @PathVariable UUID orderId) {
    cancelOrderUseCase.cancelOwnOrder(orderId);
    return ResponseEntity.ok()
        .cacheControl(CacheControl.noStore())
        .body(ClientOrderResponse.from(ownOrders.getOwnOrder(user(authentication), orderId)));
  }

  private UUID user(Authentication authentication) {
    return orderAuthorization
        .authenticatedUser(authentication)
        .orElseThrow(() -> new AccessDeniedException("Client identity unavailable"));
  }
}

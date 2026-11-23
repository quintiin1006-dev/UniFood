package com.santotofood.adapter.in.web;

import com.santotofood.adapter.in.web.dto.OrderNoticesResponse;
import com.santotofood.application.port.in.GetOrderNoticesUseCase;
import com.santotofood.application.port.in.MarkOrderNoticesReadUseCase;
import com.santotofood.config.OrderAuthorization;
import java.util.List;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * The client's bell inbox. The user comes from the verified token and the role from the database;
 * no query parameter or body can choose whose notices are read or marked.
 */
@RestController
@RequestMapping("/api/me/notices")
public class OrderNoticeController {
  private final GetOrderNoticesUseCase notices;
  private final MarkOrderNoticesReadUseCase reads;
  private final OrderAuthorization authorization;

  public OrderNoticeController(
      GetOrderNoticesUseCase notices,
      MarkOrderNoticesReadUseCase reads,
      OrderAuthorization authorization) {
    this.notices = notices;
    this.reads = reads;
    this.authorization = authorization;
  }

  @GetMapping
  @PreAuthorize("@orderAuthorization.client(authentication)")
  public ResponseEntity<OrderNoticesResponse> recent(Authentication authentication) {
    var body = OrderNoticesResponse.of(notices.recentNotices(user(authentication)));
    return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(body);
  }

  /** Idempotent: 200 also when every notice was already read. */
  @PostMapping("/read")
  @PreAuthorize("@orderAuthorization.client(authentication)")
  public ResponseEntity<OrderNoticesResponse> markRead(Authentication authentication) {
    reads.markNoticesRead(user(authentication));
    return ResponseEntity.ok()
        .cacheControl(CacheControl.noStore())
        .body(new OrderNoticesResponse(List.of(), 0));
  }

  private UUID user(Authentication authentication) {
    return authorization
        .authenticatedUser(authentication)
        .orElseThrow(() -> new AccessDeniedException("Client identity unavailable"));
  }
}

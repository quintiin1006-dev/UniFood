package com.santotofood.adapter.in.web;

import com.santotofood.adapter.in.web.dto.CashRequests;
import com.santotofood.adapter.in.web.dto.CashResponses;
import com.santotofood.application.port.in.GetCashSessionUseCase;
import com.santotofood.application.port.in.ListCashSessionsUseCase;
import com.santotofood.config.OrderAuthorization;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Read-only cash closures of every cafeteria for SUPER_ADMIN (docs/decisiones.md §14). */
@RestController
@RequestMapping("/api/super-admin/cash")
@PreAuthorize("@orderAuthorization.superAdmin(authentication)")
public class SuperAdminCashController {
  private final OrderAuthorization authorization;
  private final GetCashSessionUseCase detail;
  private final ListCashSessionsUseCase list;

  public SuperAdminCashController(
      OrderAuthorization authorization,
      GetCashSessionUseCase detail,
      ListCashSessionsUseCase list) {
    this.authorization = authorization;
    this.detail = detail;
    this.list = list;
  }

  private UUID user(Authentication authentication) {
    return authorization
        .authenticatedUser(authentication)
        .orElseThrow(() -> new AccessDeniedException("Super admin identity unavailable"));
  }

  @GetMapping("/sessions")
  public ResponseEntity<CashResponses.Listing> list(
      Authentication authentication,
      @RequestParam(name = "cafeteriaId", required = false) String cafeteriaId,
      @RequestParam(name = "from", required = false) String from,
      @RequestParam(name = "to", required = false) String to) {
    return ResponseEntity.ok()
        .cacheControl(CacheControl.noStore())
        .body(
            CashResponses.listing(
                list.listSessions(
                    user(authentication),
                    CashRequests.optionalCafeteria(cafeteriaId),
                    CashRequests.date(from),
                    CashRequests.date(to))));
  }

  @GetMapping("/sessions/{sessionId}")
  public ResponseEntity<CashResponses.Detail> detail(
      Authentication authentication, @PathVariable String sessionId) {
    UUID id = CashRequests.id(sessionId);
    return ResponseEntity.ok()
        .cacheControl(CacheControl.noStore())
        .body(CashResponses.detail(detail.getSession(user(authentication), id)));
  }

  @GetMapping("/sessions/export")
  public ResponseEntity<byte[]> export(
      Authentication authentication,
      @RequestParam(name = "cafeteriaId", required = false) String cafeteriaId,
      @RequestParam(name = "from", required = false) String from,
      @RequestParam(name = "to", required = false) String to) {
    var start = CashRequests.date(from);
    var end = CashRequests.date(to);
    var listing =
        list.listSessions(
            user(authentication), CashRequests.optionalCafeteria(cafeteriaId), start, end);
    return CashController.csv(
        listing.sessions(), "cierres-de-caja-" + start + "-a-" + end + ".csv");
  }
}

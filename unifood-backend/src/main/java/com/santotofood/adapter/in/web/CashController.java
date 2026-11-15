package com.santotofood.adapter.in.web;

import com.santotofood.adapter.in.web.dto.CashRequests;
import com.santotofood.adapter.in.web.dto.CashResponses;
import com.santotofood.application.port.in.CloseCashSessionUseCase;
import com.santotofood.application.port.in.GetCashSessionUseCase;
import com.santotofood.application.port.in.GetCurrentCashSessionUseCase;
import com.santotofood.application.port.in.ListCashSessionsUseCase;
import com.santotofood.application.port.in.OpenCashSessionUseCase;
import com.santotofood.application.port.in.PreviewCashCloseUseCase;
import com.santotofood.application.port.in.RecordCashMovementUseCase;
import com.santotofood.application.port.in.ReopenCashSessionUseCase;
import com.santotofood.application.port.in.UpdateCashToleranceUseCase;
import com.santotofood.config.OrderAuthorization;
import jakarta.servlet.http.HttpServletRequest;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Cash register of the caller's cafeteria (WORKER or ADMIN, read from the database on every call).
 * No route takes a cafeteria id: it always comes from the caller's assignment.
 */
@RestController
@RequestMapping("/api/cash")
@PreAuthorize("@orderAuthorization.cashOperator(authentication)")
public class CashController {
  private final OrderAuthorization authorization;
  private final GetCurrentCashSessionUseCase current;
  private final OpenCashSessionUseCase open;
  private final RecordCashMovementUseCase movement;
  private final PreviewCashCloseUseCase preview;
  private final CloseCashSessionUseCase close;
  private final ReopenCashSessionUseCase reopen;
  private final GetCashSessionUseCase detail;
  private final ListCashSessionsUseCase list;
  private final UpdateCashToleranceUseCase tolerance;

  public CashController(
      OrderAuthorization authorization,
      GetCurrentCashSessionUseCase current,
      OpenCashSessionUseCase open,
      RecordCashMovementUseCase movement,
      PreviewCashCloseUseCase preview,
      CloseCashSessionUseCase close,
      ReopenCashSessionUseCase reopen,
      GetCashSessionUseCase detail,
      ListCashSessionsUseCase list,
      UpdateCashToleranceUseCase tolerance) {
    this.authorization = authorization;
    this.current = current;
    this.open = open;
    this.movement = movement;
    this.preview = preview;
    this.close = close;
    this.reopen = reopen;
    this.detail = detail;
    this.list = list;
    this.tolerance = tolerance;
  }

  private UUID user(Authentication authentication) {
    return authorization
        .authenticatedUser(authentication)
        .orElseThrow(() -> new AccessDeniedException("Cash identity unavailable"));
  }

  private static <T> ResponseEntity<T> ok(T body) {
    return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(body);
  }

  @GetMapping("/current")
  public ResponseEntity<CashResponses.Current> current(Authentication authentication) {
    return ok(CashResponses.current(current.currentSession(user(authentication))));
  }

  @PostMapping("/sessions")
  public ResponseEntity<CashResponses.Current> open(
      Authentication authentication, HttpServletRequest request) {
    var body = CashRequests.open(request);
    return ok(
        CashResponses.current(
            open.openSession(user(authentication), body.shift(), body.openingFloat())));
  }

  @PostMapping("/sessions/{sessionId}/movements")
  public ResponseEntity<CashResponses.Current> movement(
      Authentication authentication, @PathVariable String sessionId, HttpServletRequest request) {
    UUID id = CashRequests.id(sessionId);
    var body = CashRequests.movement(request);
    return ok(
        CashResponses.current(
            movement.recordMovement(
                user(authentication),
                id,
                body.requestId(),
                body.kind(),
                body.amount(),
                body.reason())));
  }

  @PostMapping("/sessions/{sessionId}/close-preview")
  public ResponseEntity<CashResponses.Preview> preview(
      Authentication authentication, @PathVariable String sessionId, HttpServletRequest request) {
    UUID id = CashRequests.id(sessionId);
    var count = CashRequests.preview(request);
    return ok(CashResponses.preview(preview.previewClose(user(authentication), id, count)));
  }

  @PostMapping("/sessions/{sessionId}/close")
  public ResponseEntity<CashResponses.Detail> close(
      Authentication authentication, @PathVariable String sessionId, HttpServletRequest request) {
    UUID id = CashRequests.id(sessionId);
    var body = CashRequests.close(request);
    return ok(
        CashResponses.detail(
            close.closeSession(
                user(authentication),
                new CloseCashSessionUseCase.Command(
                    id,
                    body.count(),
                    body.note(),
                    body.expectedCash(),
                    body.expectedVersion(),
                    body.force()))));
  }

  @PostMapping("/sessions/{sessionId}/reopen")
  public ResponseEntity<CashResponses.Detail> reopen(
      Authentication authentication, @PathVariable String sessionId, HttpServletRequest request) {
    UUID id = CashRequests.id(sessionId);
    var body = CashRequests.reopen(request);
    return ok(
        CashResponses.detail(
            reopen.reopenSession(user(authentication), id, body.reason(), body.expectedVersion())));
  }

  @GetMapping("/sessions/{sessionId}")
  public ResponseEntity<CashResponses.Detail> detail(
      Authentication authentication, @PathVariable String sessionId) {
    UUID id = CashRequests.id(sessionId);
    return ok(CashResponses.detail(detail.getSession(user(authentication), id)));
  }

  @GetMapping("/sessions")
  public ResponseEntity<CashResponses.Listing> list(
      Authentication authentication,
      @RequestParam(name = "from", required = false) String from,
      @RequestParam(name = "to", required = false) String to) {
    return ok(
        CashResponses.listing(
            list.listSessions(
                user(authentication), null, CashRequests.date(from), CashRequests.date(to))));
  }

  @GetMapping("/sessions/export")
  public ResponseEntity<byte[]> export(
      Authentication authentication,
      @RequestParam(name = "from", required = false) String from,
      @RequestParam(name = "to", required = false) String to) {
    var start = CashRequests.date(from);
    var end = CashRequests.date(to);
    var listing = list.listSessions(user(authentication), null, start, end);
    return csv(listing.sessions(), "cierres-de-caja-" + start + "-a-" + end + ".csv");
  }

  @PutMapping("/settings")
  public ResponseEntity<CashResponses.Settings> settings(
      Authentication authentication, HttpServletRequest request) {
    var body = CashRequests.tolerance(request);
    int version =
        tolerance.updateTolerance(
            user(authentication), body.toleranceCop(), body.expectedVersion());
    return ok(new CashResponses.Settings(body.toleranceCop(), version));
  }

  static ResponseEntity<byte[]> csv(
      java.util.List<com.santotofood.application.model.CashSession> sessions, String filename) {
    return ResponseEntity.ok()
        .cacheControl(CacheControl.noStore())
        .contentType(new MediaType("text", "csv", java.nio.charset.StandardCharsets.UTF_8))
        .header(
            HttpHeaders.CONTENT_DISPOSITION,
            ContentDisposition.attachment().filename(filename).build().toString())
        .body(CashCsv.render(sessions));
  }
}

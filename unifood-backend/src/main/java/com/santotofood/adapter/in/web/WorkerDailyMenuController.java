package com.santotofood.adapter.in.web;

import com.santotofood.adapter.in.web.dto.WorkerDailyMenuResponse;
import com.santotofood.application.model.WorkerDailyMenu;
import com.santotofood.application.port.in.ManageWorkerDailyMenuUseCase;
import com.santotofood.config.OrderAuthorization;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

/**
 * WORKER daily menu of their own cafeteria (docs/propuesta-menu-dinamico.md, section 3.1). Only an
 * active, exclusive WORKER with one cafeteria passes; ADMIN does not publish. Writes carry the
 * screen's business date in X-Business-Date, as availability does, and the version it saw.
 */
@RestController
@RequestMapping("/api/worker/daily-menu/today")
@PreAuthorize("isAuthenticated()")
public class WorkerDailyMenuController {
  private static final String DATE = "X-Business-Date";
  private final OrderAuthorization authorization;
  private final ManageWorkerDailyMenuUseCase menus;

  public WorkerDailyMenuController(
      OrderAuthorization authorization, ManageWorkerDailyMenuUseCase menus) {
    this.authorization = authorization;
    this.menus = menus;
  }

  public record OptionsRequest(@NotNull Long expectedVersion, @NotNull List<String> options) {}

  public record AdditionRequest(@NotNull Long expectedVersion, @NotNull Boolean available) {}

  public record VersionRequest(@NotNull Long expectedVersion) {}

  @GetMapping
  public ResponseEntity<WorkerDailyMenuResponse> today(Authentication authentication) {
    return ok(menus.getToday(cafeteria(authentication)));
  }

  @PutMapping("/categories/{categoryId}/options")
  public ResponseEntity<WorkerDailyMenuResponse> options(
      Authentication authentication,
      @PathVariable UUID categoryId,
      @RequestHeader(DATE) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate context,
      @Valid @RequestBody OptionsRequest request) {
    return ok(
        menus.replaceOptions(
            cafeteria(authentication),
            context,
            request.expectedVersion(),
            categoryId,
            request.options()));
  }

  @PutMapping("/additions/{additionId}")
  public ResponseEntity<WorkerDailyMenuResponse> addition(
      Authentication authentication,
      @PathVariable UUID additionId,
      @RequestHeader(DATE) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate context,
      @Valid @RequestBody AdditionRequest request) {
    return ok(
        menus.setAddition(
            cafeteria(authentication),
            context,
            request.expectedVersion(),
            additionId,
            request.available()));
  }

  @PostMapping("/copy-yesterday")
  public ResponseEntity<WorkerDailyMenuResponse> copyYesterday(
      Authentication authentication,
      @RequestHeader(DATE) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate context,
      @Valid @RequestBody VersionRequest request) {
    return ok(menus.copyYesterday(cafeteria(authentication), context, request.expectedVersion()));
  }

  @PostMapping("/publish")
  public ResponseEntity<WorkerDailyMenuResponse> publish(
      Authentication authentication,
      @RequestHeader(DATE) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate context,
      @Valid @RequestBody VersionRequest request) {
    var cafeteria = cafeteria(authentication);
    var worker =
        authorization
            .authenticatedUser(authentication)
            .orElseThrow(() -> new AccessDeniedException("Worker identity unavailable"));
    return ok(menus.publish(cafeteria, worker, context, request.expectedVersion()));
  }

  @PostMapping("/unpublish")
  public ResponseEntity<WorkerDailyMenuResponse> unpublish(
      Authentication authentication,
      @RequestHeader(DATE) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate context,
      @Valid @RequestBody VersionRequest request) {
    return ok(menus.unpublish(cafeteria(authentication), context, request.expectedVersion()));
  }

  private UUID cafeteria(Authentication authentication) {
    return authorization
        .workerCafeteria(authentication)
        .orElseThrow(() -> new AccessDeniedException("Worker daily menu unavailable"));
  }

  private ResponseEntity<WorkerDailyMenuResponse> ok(WorkerDailyMenu menu) {
    return ResponseEntity.ok()
        .cacheControl(CacheControl.noStore())
        .body(WorkerDailyMenuResponse.from(menu));
  }
}

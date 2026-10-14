package com.santotofood.adapter.in.web;

import com.santotofood.adapter.in.web.dto.TodayAvailabilityResponse;
import com.santotofood.application.port.in.GetTodayAvailabilityUseCase;
import com.santotofood.application.port.in.SetDailyAvailabilityUseCase;
import com.santotofood.config.OrderAuthorization;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import java.time.LocalDate;
import java.util.UUID;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/worker/availability/today")
@PreAuthorize("isAuthenticated()")
public class AvailabilityController {
  private final OrderAuthorization authorization;
  private final GetTodayAvailabilityUseCase read;
  private final SetDailyAvailabilityUseCase write;

  public AvailabilityController(
      OrderAuthorization authorization,
      GetTodayAvailabilityUseCase read,
      SetDailyAvailabilityUseCase write) {
    this.authorization = authorization;
    this.read = read;
    this.write = write;
  }

  public record ItemRequest(@NotNull Boolean available) {}

  public record CafeteriaRequest(@NotNull Boolean open) {}

  public record ItemResponse(LocalDate businessDate, UUID itemId, boolean available) {}

  public record CafeteriaResponse(LocalDate businessDate, boolean open) {}

  @GetMapping
  public ResponseEntity<TodayAvailabilityResponse> today(Authentication authentication) {
    return ok(TodayAvailabilityResponse.from(read.getToday(cafeteria(authentication))));
  }

  @PutMapping("/items/{itemId}")
  public ResponseEntity<ItemResponse> item(
      Authentication authentication,
      @PathVariable UUID itemId,
      @RequestHeader("X-Business-Date") @DateTimeFormat(iso = DateTimeFormat.ISO.DATE)
          LocalDate context,
      @Valid @RequestBody ItemRequest request) {
    var state = write.setItem(cafeteria(authentication), itemId, context, request.available());
    return ok(new ItemResponse(state.businessDate().value(), state.itemId(), state.available()));
  }

  @PutMapping("/cafeteria-state")
  public ResponseEntity<CafeteriaResponse> cafeteriaState(
      Authentication authentication,
      @RequestHeader("X-Business-Date") @DateTimeFormat(iso = DateTimeFormat.ISO.DATE)
          LocalDate context,
      @Valid @RequestBody CafeteriaRequest request) {
    var state = write.setCafeteria(cafeteria(authentication), context, request.open());
    return ok(new CafeteriaResponse(state.businessDate().value(), state.open()));
  }

  private UUID cafeteria(Authentication authentication) {
    return authorization
        .workerCafeteria(authentication)
        .orElseThrow(() -> new AccessDeniedException("Worker availability unavailable"));
  }

  private <T> ResponseEntity<T> ok(T body) {
    return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(body);
  }
}

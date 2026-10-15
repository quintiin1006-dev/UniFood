package com.santotofood.adapter.in.web;

import com.santotofood.adapter.in.web.dto.TodayWorkerHistoryResponse;
import com.santotofood.application.port.in.GetTodayWorkerHistoryUseCase;
import com.santotofood.config.OrderAuthorization;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/worker/orders/history/today")
@PreAuthorize("isAuthenticated()")
public class WorkerHistoryController {
  private final OrderAuthorization authorization;
  private final GetTodayWorkerHistoryUseCase history;

  public WorkerHistoryController(
      OrderAuthorization authorization, GetTodayWorkerHistoryUseCase history) {
    this.authorization = authorization;
    this.history = history;
  }

  @GetMapping
  public ResponseEntity<TodayWorkerHistoryResponse> today(Authentication authentication) {
    var cafeteria =
        authorization
            .workerCafeteria(authentication)
            .orElseThrow(() -> new AccessDeniedException("Worker history unavailable"));
    return ResponseEntity.ok()
        .cacheControl(CacheControl.noStore())
        .body(TodayWorkerHistoryResponse.from(history.getToday(cafeteria)));
  }
}

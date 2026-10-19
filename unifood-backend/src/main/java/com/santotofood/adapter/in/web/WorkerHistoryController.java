package com.santotofood.adapter.in.web;

import com.santotofood.adapter.in.web.dto.WorkerHistoryResponse;
import com.santotofood.application.exception.InvalidWorkerHistoryRequestException;
import com.santotofood.application.model.WorkerHistoryRequest;
import com.santotofood.application.port.in.GetWorkerHistoryUseCase;
import com.santotofood.config.OrderAuthorization;
import java.util.Set;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.util.MultiValueMap;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/worker/orders/history")
@PreAuthorize("isAuthenticated()")
public class WorkerHistoryController {
  private final OrderAuthorization authorization;
  private final GetWorkerHistoryUseCase history;

  public WorkerHistoryController(
      OrderAuthorization authorization, GetWorkerHistoryUseCase history) {
    this.authorization = authorization;
    this.history = history;
  }

  @GetMapping
  public ResponseEntity<WorkerHistoryResponse> history(
      Authentication authentication, @RequestParam MultiValueMap<String, String> parameters) {
    var cafeteria =
        authorization
            .workerCafeteria(authentication)
            .orElseThrow(() -> new AccessDeniedException("Worker history unavailable"));
    var allowed = Set.of("q", "range", "status", "cursor", "limit");
    if (parameters.entrySet().stream()
        .anyMatch(e -> !allowed.contains(e.getKey()) || e.getValue().size() != 1))
      throw new InvalidWorkerHistoryRequestException();
    var criteria =
        WorkerHistoryRequest.parse(
            parameters.getFirst("q"),
            parameters.getFirst("range"),
            parameters.getFirst("status"),
            parameters.getFirst("cursor"),
            parameters.getFirst("limit"));
    return ResponseEntity.ok()
        .cacheControl(CacheControl.noStore())
        .body(WorkerHistoryResponse.from(history.getHistory(cafeteria, criteria)));
  }
}

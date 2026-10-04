package com.santotofood.adapter.in.web;

import com.santotofood.config.OrderAuthorization;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequiredArgsConstructor
public class WorkerContextController {
  private final OrderAuthorization orderAuthorization;

  public record WorkerContextResponse(UUID cafeteriaId) {}

  @GetMapping("/api/worker/context")
  @PreAuthorize("isAuthenticated()")
  public ResponseEntity<WorkerContextResponse> context(Authentication authentication) {
    UUID cafeteriaId =
        orderAuthorization
            .workerCafeteria(authentication)
            .orElseThrow(() -> new AccessDeniedException("Worker context unavailable"));
    return ResponseEntity.ok()
        .cacheControl(CacheControl.noStore())
        .body(new WorkerContextResponse(cafeteriaId));
  }
}

package com.santotofood.adapter.in.web;

import com.santotofood.adapter.in.web.dto.WorkerProfileResponse;
import com.santotofood.application.port.in.GetWorkerProfileUseCase;
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
@RequestMapping("/api/worker/profile")
@PreAuthorize("isAuthenticated()")
public class WorkerProfileController {
  private final OrderAuthorization authorization;
  private final GetWorkerProfileUseCase profiles;

  public WorkerProfileController(
      OrderAuthorization authorization, GetWorkerProfileUseCase profiles) {
    this.authorization = authorization;
    this.profiles = profiles;
  }

  @GetMapping
  public ResponseEntity<WorkerProfileResponse> profile(Authentication authentication) {
    var user =
        authorization
            .authenticatedUser(authentication)
            .orElseThrow(() -> new AccessDeniedException("Worker identity unavailable"));
    return ResponseEntity.ok()
        .cacheControl(CacheControl.noStore())
        .body(WorkerProfileResponse.from(profiles.getWorkerProfile(user)));
  }
}

package com.santotofood.application.service;

import com.santotofood.application.exception.WorkerProfileForbiddenException;
import com.santotofood.application.model.WorkerProfileDetails;
import com.santotofood.application.port.in.GetWorkerProfileUseCase;
import com.santotofood.application.port.out.WorkerProfileQueryPort;
import java.util.Objects;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

@Service
public class WorkerProfileService implements GetWorkerProfileUseCase {
  private final OrderAuthorizationService authorization;
  private final WorkerProfileQueryPort profiles;

  public WorkerProfileService(
      OrderAuthorizationService authorization, WorkerProfileQueryPort profiles) {
    this.authorization = authorization;
    this.profiles = profiles;
  }

  @Override
  @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ, timeout = 15)
  public WorkerProfileDetails getWorkerProfile(UUID authenticatedUserId) {
    Objects.requireNonNull(authenticatedUserId);
    // The existing policy validates active user, exclusive WORKER and one assignment.
    // One read snapshot keeps that decision and the institutional context coherent.
    var cafeteria =
        authorization
            .workerCafeteria(authenticatedUserId)
            .orElseThrow(WorkerProfileForbiddenException::new);
    return profiles
        .findByUserAndCafeteria(authenticatedUserId, cafeteria)
        .orElseThrow(WorkerProfileForbiddenException::new);
  }
}

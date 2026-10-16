package com.santotofood.application.port.out;

import com.santotofood.application.model.WorkerProfileDetails;
import java.util.Optional;
import java.util.UUID;

public interface WorkerProfileQueryPort {
  Optional<WorkerProfileDetails> findByUserAndCafeteria(UUID userId, UUID authorizedCafeteriaId);
}

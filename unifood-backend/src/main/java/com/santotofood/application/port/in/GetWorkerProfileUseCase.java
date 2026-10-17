package com.santotofood.application.port.in;

import com.santotofood.application.model.WorkerProfileDetails;
import java.util.UUID;

public interface GetWorkerProfileUseCase {
  WorkerProfileDetails getWorkerProfile(UUID authenticatedUserId);
}

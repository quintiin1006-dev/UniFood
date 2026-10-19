package com.santotofood.application.port.in;

import com.santotofood.application.model.WorkerHistory;
import com.santotofood.application.model.WorkerHistoryRequest;
import java.util.UUID;

public interface GetWorkerHistoryUseCase {
  WorkerHistory getHistory(UUID authorizedCafeteriaId, WorkerHistoryRequest request);
}

package com.santotofood.application.port.out;

import com.santotofood.application.model.WorkerHistory;
import com.santotofood.application.model.WorkerHistoryCursor;
import com.santotofood.domain.model.OrderStatus;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

public interface WorkerHistoryQueryPort {
  record Query(
      UUID cafeteriaId,
      Instant start,
      Instant end,
      Instant monthStart,
      String search,
      List<String> searchStatuses,
      OrderStatus status,
      WorkerHistoryCursor after,
      int limit) {}

  record Result(List<WorkerHistory.Entry> orders, boolean hasHistory) {}

  Result findCompleted(Query query);
}

package com.santotofood.application.port.out;

import com.santotofood.application.model.TodayWorkerHistory;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

public interface WorkerHistoryQueryPort {
  List<TodayWorkerHistory.Entry> findCompleted(
      UUID authorizedCafeteriaId, Instant dayStart, Instant nextDayStart);
}

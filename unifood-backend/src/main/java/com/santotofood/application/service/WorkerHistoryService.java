package com.santotofood.application.service;

import com.santotofood.application.model.TodayWorkerHistory;
import com.santotofood.application.port.in.GetTodayWorkerHistoryUseCase;
import com.santotofood.application.port.out.WorkerHistoryQueryPort;
import com.santotofood.domain.model.BusinessDate;
import com.santotofood.domain.port.out.TimeProvider;
import java.util.Objects;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class WorkerHistoryService implements GetTodayWorkerHistoryUseCase {
  private final WorkerHistoryQueryPort history;
  private final TimeProvider time;

  public WorkerHistoryService(WorkerHistoryQueryPort history, TimeProvider time) {
    this.history = history;
    this.time = time;
  }

  @Override
  @Transactional(readOnly = true, timeout = 15)
  public TodayWorkerHistory getToday(UUID authorizedCafeteriaId) {
    Objects.requireNonNull(authorizedCafeteriaId);
    // Capture one instant: an in-flight request cannot mix the two business days.
    BusinessDate date = BusinessDate.from(time.now());
    var nextDayStart = date.nextDayStartInstant();
    return new TodayWorkerHistory(
        date,
        nextDayStart,
        history.findCompleted(authorizedCafeteriaId, date.dayStartInstant(), nextDayStart));
  }
}

package com.santotofood.application.port.in;

import com.santotofood.application.model.TodayWorkerHistory;
import java.util.UUID;

public interface GetTodayWorkerHistoryUseCase {
  TodayWorkerHistory getToday(UUID authorizedCafeteriaId);
}

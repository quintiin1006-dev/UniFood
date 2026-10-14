package com.santotofood.application.port.in;

import com.santotofood.application.model.TodayAvailability;
import java.util.UUID;

public interface GetTodayAvailabilityUseCase {
  TodayAvailability getToday(UUID authorizedCafeteriaId);
}

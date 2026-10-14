package com.santotofood.application.port.in;

import com.santotofood.domain.model.CafeteriaDailyState;
import com.santotofood.domain.model.DailyItemAvailability;
import java.time.LocalDate;
import java.util.UUID;

public interface SetDailyAvailabilityUseCase {
  CafeteriaDailyState setCafeteria(UUID authorizedCafeteriaId, LocalDate context, boolean open);

  DailyItemAvailability setItem(
      UUID authorizedCafeteriaId, UUID itemId, LocalDate context, boolean available);
}

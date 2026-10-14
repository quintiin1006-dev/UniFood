package com.santotofood.application.port.out;

import com.santotofood.application.model.AvailabilityItemStatus;
import com.santotofood.application.model.AvailabilitySnapshot;
import com.santotofood.domain.model.BusinessDate;
import com.santotofood.domain.model.CafeteriaDailyState;
import com.santotofood.domain.model.DailyItemAvailability;
import java.util.Optional;
import java.util.UUID;

public interface DailyAvailabilityPort {
  Optional<AvailabilitySnapshot> find(UUID cafeteriaId, BusinessDate date);

  Optional<Boolean> lockCafeteriaActivity(UUID cafeteriaId);

  Optional<AvailabilityItemStatus> lockItem(UUID cafeteriaId, UUID itemId);

  CafeteriaDailyState setCafeteria(UUID cafeteriaId, BusinessDate date, boolean open);

  DailyItemAvailability setItem(
      UUID cafeteriaId, UUID itemId, BusinessDate date, boolean available);
}

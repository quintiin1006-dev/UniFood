package com.santotofood.application.service;

import com.santotofood.application.exception.AvailabilityException;
import com.santotofood.application.model.TodayAvailability;
import com.santotofood.application.port.in.GetTodayAvailabilityUseCase;
import com.santotofood.application.port.in.SetDailyAvailabilityUseCase;
import com.santotofood.application.port.out.DailyAvailabilityPort;
import com.santotofood.domain.model.BusinessDate;
import com.santotofood.domain.model.CafeteriaDailyState;
import com.santotofood.domain.model.CatalogCategory;
import com.santotofood.domain.model.DailyItemAvailability;
import com.santotofood.domain.port.out.TimeProvider;
import com.santotofood.shared.error.ErrorCode;
import java.time.LocalDate;
import java.util.Arrays;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AvailabilityService
    implements GetTodayAvailabilityUseCase, SetDailyAvailabilityUseCase {
  private final DailyAvailabilityPort availability;
  private final TimeProvider time;

  public AvailabilityService(DailyAvailabilityPort availability, TimeProvider time) {
    this.availability = availability;
    this.time = time;
  }

  @Override
  @Transactional(readOnly = true)
  public TodayAvailability getToday(UUID cafeteriaId) {
    BusinessDate date = today();
    var snapshot =
        availability
            .find(cafeteriaId, date)
            .orElseThrow(() -> error(ErrorCode.AVAILABILITY_CAFETERIA_NOT_FOUND));
    if (snapshot.items().stream().anyMatch(item -> item.category() == null))
      throw error(ErrorCode.AVAILABILITY_CATALOG_INVALID);
    var categories =
        Arrays.stream(CatalogCategory.values())
            .map(
                category ->
                    new TodayAvailability.Category(
                        category,
                        snapshot.items().stream()
                            .filter(item -> item.category() == category)
                            .toList()))
            .toList();
    return new TodayAvailability(date, snapshot.cafeteria(), categories);
  }

  @Override
  @Transactional(timeout = 15)
  public CafeteriaDailyState setCafeteria(UUID cafeteriaId, LocalDate context, boolean open) {
    checkContext(context);
    boolean active =
        availability
            .lockCafeteriaActivity(cafeteriaId)
            .orElseThrow(() -> error(ErrorCode.AVAILABILITY_CAFETERIA_NOT_FOUND));
    BusinessDate date = checkContext(context);
    if (open && !active) throw error(ErrorCode.AVAILABILITY_CAFETERIA_INACTIVE);
    var state = availability.setCafeteria(cafeteriaId, date, open);
    // A wait on the UPSERT may span midnight. Reject and roll back that write.
    checkContext(context);
    return state;
  }

  @Override
  @Transactional(timeout = 15)
  public DailyItemAvailability setItem(
      UUID cafeteriaId, UUID itemId, LocalDate context, boolean available) {
    checkContext(context);
    boolean active =
        availability
            .lockCafeteriaActivity(cafeteriaId)
            .orElseThrow(() -> error(ErrorCode.AVAILABILITY_CAFETERIA_NOT_FOUND));
    var item =
        availability
            .lockItem(cafeteriaId, itemId)
            .orElseThrow(() -> error(ErrorCode.AVAILABILITY_ITEM_NOT_FOUND));
    BusinessDate date = checkContext(context);
    if (available) {
      if (!active) throw error(ErrorCode.AVAILABILITY_CAFETERIA_INACTIVE);
      if (!item.active()) throw error(ErrorCode.AVAILABILITY_ITEM_INACTIVE);
      if (item.category() == null) throw error(ErrorCode.AVAILABILITY_CATALOG_INVALID);
    }
    var state = availability.setItem(cafeteriaId, itemId, date, available);
    checkContext(context);
    return state;
  }

  private BusinessDate today() {
    return BusinessDate.from(time.now());
  }

  private BusinessDate checkContext(LocalDate context) {
    if (context == null) throw error(ErrorCode.AVAILABILITY_INVALID_REQUEST);
    BusinessDate date = today();
    if (!date.value().equals(context)) throw error(ErrorCode.AVAILABILITY_DAY_EXPIRED);
    return date;
  }

  private AvailabilityException error(ErrorCode code) {
    return new AvailabilityException(code);
  }
}

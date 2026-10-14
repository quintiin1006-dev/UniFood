package com.santotofood.application.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.santotofood.application.exception.AvailabilityException;
import com.santotofood.application.model.AvailabilityItemStatus;
import com.santotofood.application.model.AvailabilitySnapshot;
import com.santotofood.application.port.out.DailyAvailabilityPort;
import com.santotofood.domain.model.*;
import com.santotofood.domain.port.out.TimeProvider;
import com.santotofood.shared.error.ErrorCode;
import java.math.BigDecimal;
import java.time.*;
import java.util.*;
import org.junit.jupiter.api.*;

class AvailabilityServiceTest {
  final UUID cafe = UUID.randomUUID(), item = UUID.randomUUID();
  final LocalDate day = LocalDate.of(2026, 10, 13);
  final Instant now = Instant.parse("2026-10-13T12:00:00Z");
  final DailyAvailabilityPort persistence = mock(DailyAvailabilityPort.class);
  final TimeProvider time = mock(TimeProvider.class);
  final AvailabilityService service = new AvailabilityService(persistence, time);

  @BeforeEach
  void setup() {
    when(time.now()).thenReturn(now);
    when(persistence.lockCafeteriaActivity(cafe)).thenReturn(Optional.of(true));
    when(persistence.lockItem(cafe, item))
        .thenReturn(Optional.of(new AvailabilityItemStatus(true, CatalogCategory.CORRIENTE)));
  }

  @Test
  void invalidCatalogIsNotInferredOrSilentlyHidden() {
    when(persistence.find(cafe, new BusinessDate(day)))
        .thenReturn(
            Optional.of(
                new AvailabilitySnapshot(
                    new AvailabilitySnapshot.Cafeteria(cafe, "Cafe", true, false),
                    List.of(
                        new AvailabilitySnapshot.Item(
                            item, "Invalid", null, BigDecimal.ONE, null, null, false)))));
    assertCode(ErrorCode.AVAILABILITY_CATALOG_INVALID, () -> service.getToday(cafe));
  }

  @Test
  void safeDisableWorksEvenForInactiveUnclassifiedLegacyItem() {
    when(persistence.lockCafeteriaActivity(cafe)).thenReturn(Optional.of(false));
    when(persistence.lockItem(cafe, item))
        .thenReturn(Optional.of(new AvailabilityItemStatus(false, null)));
    service.setItem(cafe, item, day, false);
    verify(persistence).setItem(cafe, item, new BusinessDate(day), false);
    assertCode(
        ErrorCode.AVAILABILITY_CAFETERIA_INACTIVE, () -> service.setItem(cafe, item, day, true));
  }

  @Test
  void invalidContextDoesNotReachPersistence() {
    assertCode(
        ErrorCode.AVAILABILITY_INVALID_REQUEST, () -> service.setCafeteria(cafe, null, true));
    assertCode(
        ErrorCode.AVAILABILITY_DAY_EXPIRED,
        () -> service.setItem(cafe, item, day.minusDays(1), true));
    verifyNoInteractions(persistence);
  }

  @Test
  void midnightDuringParentLockPreventsAnyWrite() {
    when(time.now()).thenReturn(now, Instant.parse("2026-10-14T05:00:00Z"));
    assertCode(ErrorCode.AVAILABILITY_DAY_EXPIRED, () -> service.setCafeteria(cafe, day, true));
    verify(persistence, never()).setCafeteria(any(), any(), anyBoolean());
  }

  @Test
  void unclassifiedActiveItemCannotBeEnabled() {
    when(persistence.lockItem(cafe, item))
        .thenReturn(Optional.of(new AvailabilityItemStatus(true, null)));
    assertCode(
        ErrorCode.AVAILABILITY_CATALOG_INVALID, () -> service.setItem(cafe, item, day, true));
    verify(persistence, never()).setItem(any(), any(), any(), anyBoolean());
  }

  void assertCode(ErrorCode code, Runnable action) {
    assertEquals(code, assertThrows(AvailabilityException.class, action::run).getCode());
  }
}

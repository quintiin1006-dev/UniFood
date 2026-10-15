package com.santotofood.application.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.santotofood.application.model.TodayWorkerHistory;
import com.santotofood.application.port.out.WorkerHistoryQueryPort;
import com.santotofood.domain.model.OrderStatus;
import com.santotofood.domain.port.out.TimeProvider;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class WorkerHistoryServiceTest {
  final UUID cafe = UUID.randomUUID();
  final WorkerHistoryQueryPort query = mock(WorkerHistoryQueryPort.class);
  final TimeProvider time = mock(TimeProvider.class);
  final WorkerHistoryService service = new WorkerHistoryService(query, time);
  final Instant start = Instant.parse("2026-10-13T05:00:00Z");
  final Instant next = Instant.parse("2026-10-14T05:00:00Z");

  @Test
  void oneClockReadingKeepsTheEnvelopeAndQueryOnTheSameDayAtMidnight() {
    when(time.now()).thenReturn(next.minusNanos(1), next);
    when(query.findCompleted(cafe, start, next)).thenReturn(List.of());
    var result = service.getToday(cafe);
    assertEquals(LocalDate.of(2026, 10, 13), result.businessDate().value());
    assertEquals(next, result.nextBusinessDateAt());
    assertTrue(result.orders().isEmpty());
    verify(time).now();
    verifyNoMoreInteractions(time);
    verify(query).findCompleted(cafe, start, next);
    verifyNoMoreInteractions(query);
  }

  @Test
  void queryOrderAndHistoricalAmountsArePreserved() {
    when(time.now()).thenReturn(start);
    var recent = entry("ffffffff-ffff-ffff-ffff-ffffffffffff", start.plusSeconds(2));
    var earlier = entry("00000000-0000-0000-0000-000000000001", start.plusSeconds(1));
    when(query.findCompleted(cafe, start, next)).thenReturn(List.of(recent, earlier));
    var result = service.getToday(cafe);
    assertEquals(List.of(recent, earlier), result.orders());
    assertEquals(new BigDecimal("11000.00"), result.orders().getFirst().total());
    assertEquals("Historical name", result.orders().getFirst().items().getFirst().name());
  }

  @Test
  void aMissingBackendTimeCannotProduceAQueryWithAnInferredDay() {
    when(time.now()).thenReturn(null);
    assertThrows(NullPointerException.class, () -> service.getToday(cafe));
    verifyNoInteractions(query);
  }

  static TodayWorkerHistory.Entry entry(String id, Instant completedAt) {
    return new TodayWorkerHistory.Entry(
        UUID.fromString(id),
        OrderStatus.DELIVERED,
        completedAt,
        new BigDecimal("11000.00"),
        List.of(
            new TodayWorkerHistory.Item(
                "Historical name", 2, new BigDecimal("5500.00"), new BigDecimal("11000.00"))));
  }
}

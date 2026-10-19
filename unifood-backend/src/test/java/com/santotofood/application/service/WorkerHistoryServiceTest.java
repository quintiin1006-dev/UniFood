package com.santotofood.application.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.santotofood.application.model.*;
import com.santotofood.application.port.out.WorkerHistoryQueryPort;
import com.santotofood.domain.model.OrderStatus;
import com.santotofood.domain.port.out.TimeProvider;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.ArgumentCaptor;

class WorkerHistoryServiceTest {
  final UUID cafe = UUID.randomUUID();
  final WorkerHistoryQueryPort query = mock(WorkerHistoryQueryPort.class);
  final TimeProvider time = mock(TimeProvider.class);
  final WorkerHistoryService service = new WorkerHistoryService(query, time);

  WorkerHistoryRequest request(String range) {
    return WorkerHistoryRequest.parse(null, range, null, null, null);
  }

  WorkerHistoryQueryPort.Query captured() {
    var capture = ArgumentCaptor.forClass(WorkerHistoryQueryPort.Query.class);
    verify(query).findCompleted(capture.capture());
    return capture.getValue();
  }

  void empty() {
    when(query.findCompleted(any()))
        .thenReturn(new WorkerHistoryQueryPort.Result(List.of(), false));
  }

  @Test
  void oneClockReadingFixesMonthAndDayAcrossBogotaMidnight() {
    var next = Instant.parse("2026-11-01T05:00:00Z");
    when(time.now()).thenReturn(next.minusNanos(1), next);
    empty();
    var result = service.getHistory(cafe, request("MONTH"));
    assertEquals(LocalDate.of(2026, 10, 31), result.businessDate().value());
    assertEquals(next, result.nextBusinessDateAt());
    assertEquals(Instant.parse("2026-10-01T05:00:00Z"), captured().start());
    verify(time, times(1)).now();
  }

  @Test
  void weekIsClippedToMonthAndTodayUsesItsOwnBounds() {
    when(time.now()).thenReturn(Instant.parse("2026-11-01T05:00:00Z"));
    empty();
    var result = service.getHistory(cafe, request("WEEK"));
    assertEquals(LocalDate.of(2026, 11, 1), result.rangeStart());
    assertEquals(Instant.parse("2026-11-01T05:00:00Z"), captured().start());
  }

  @Test
  void snapshotsAndAmountsArePreservedAndOverflowProducesACursor() {
    when(time.now()).thenReturn(Instant.parse("2026-10-14T18:00:00Z"));
    var a = entry("ffffffff-ffff-ffff-ffff-ffffffffffff", Instant.parse("2026-10-14T17:00:00Z"));
    var b = entry("00000000-0000-0000-0000-000000000001", Instant.parse("2026-10-14T16:00:00Z"));
    when(query.findCompleted(any()))
        .thenReturn(new WorkerHistoryQueryPort.Result(List.of(a, b), true));
    var criteria = WorkerHistoryRequest.parse("  PÉREZ  ", "MONTH", null, null, "1");
    var result = service.getHistory(cafe, criteria);
    assertEquals(List.of(a), result.orders());
    assertTrue(result.hasHistory());
    var q = captured();
    assertEquals(2, q.limit());
    assertEquals("perez", q.search());
    assertEquals(
        a.id(),
        WorkerHistoryCursor.decode(
                result.nextCursor(),
                WorkerHistoryCursor.scope(cafe, result.monthStart(), criteria),
                q.start(),
                q.end())
            .id());
    assertThrows(
        IllegalArgumentException.class,
        () ->
            WorkerHistoryCursor.decode(
                result.nextCursor(),
                WorkerHistoryCursor.scope(UUID.randomUUID(), result.monthStart(), criteria),
                q.start(),
                q.end()));
    assertEquals(new BigDecimal("11000.00"), a.total());
    assertEquals("Historical name", a.items().getFirst().name());
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "DELIVERED",
        "entregado",
        "  Entregadó  ",
        "no recogido",
        "NOT_COLLECTED",
        "cancel"
      })
  void searchStateAliasesAreResolvedInApplication(String text) {
    when(time.now()).thenReturn(Instant.parse("2026-10-14T18:00:00Z"));
    empty();
    service.getHistory(cafe, WorkerHistoryRequest.parse(text, null, null, null, null));
    assertFalse(captured().searchStatuses().isEmpty());
  }

  @Test
  void invalidCriteriaAndExpiredOrChangedCursorFailBeforeSql() {
    assertThrows(
        IllegalArgumentException.class,
        () -> WorkerHistoryRequest.parse(null, "LAST_MONTH", null, null, null));
    assertThrows(
        IllegalArgumentException.class,
        () -> WorkerHistoryRequest.parse(null, null, "PENDING", null, null));
    for (String limit : List.of("0", "101", "-1", "bad"))
      assertThrows(
          IllegalArgumentException.class,
          () -> WorkerHistoryRequest.parse(null, null, null, null, limit));
    assertThrows(
        IllegalArgumentException.class,
        () -> WorkerHistoryRequest.parse("x".repeat(121), null, null, null, null));
    when(time.now()).thenReturn(Instant.parse("2026-11-01T05:00:00Z"));
    var old = WorkerHistoryRequest.parse(null, null, null, null, null);
    var token =
        new WorkerHistoryCursor(Instant.parse("2026-10-14T18:00:00Z"), UUID.randomUUID())
            .encode(WorkerHistoryCursor.scope(cafe, LocalDate.of(2026, 10, 1), old));
    assertThrows(
        IllegalArgumentException.class,
        () -> service.getHistory(cafe, WorkerHistoryRequest.parse(null, null, null, token, null)));
    verifyNoInteractions(query);
  }

  @Test
  void missingBackendTimeCannotInferADay() {
    assertThrows(NullPointerException.class, () -> service.getHistory(cafe, request("MONTH")));
    verifyNoInteractions(query);
  }

  static WorkerHistory.Entry entry(String id, Instant at) {
    return new WorkerHistory.Entry(
        UUID.fromString(id),
        "Juan Pérez",
        OrderStatus.DELIVERED,
        at,
        new BigDecimal("11000.00"),
        List.of(
            new WorkerHistory.Item(
                "Historical name", 2, new BigDecimal("5500.00"), new BigDecimal("11000.00"))));
  }
}

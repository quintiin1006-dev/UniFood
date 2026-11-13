package com.santotofood.application.model;

import static org.junit.jupiter.api.Assertions.*;

import com.santotofood.domain.model.OrderStatus;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

class WorkerHistoryEntryTest {
  static WorkerHistory.Entry entry(OrderStatus status, String source, String reason) {
    return new WorkerHistory.Entry(
        UUID.randomUUID(),
        "Ana Torres",
        status,
        Instant.parse("2026-11-20T17:00:00Z"),
        new BigDecimal("13000.00"),
        List.of(),
        source,
        reason);
  }

  @Test
  void aWorkerRejectionKeepsItsSourceAndReason() {
    var rejected = entry(OrderStatus.CANCELLED, "WORKER", "Se acabó el pollo");
    assertEquals("WORKER", rejected.cancellationSource());
    assertEquals("Se acabó el pollo", rejected.rejectionReason());
  }

  @ParameterizedTest
  @ValueSource(strings = {"CLIENT", "SYSTEM"})
  void onlyAWorkerRejectionCarriesAReason(String source) {
    var cancelled = entry(OrderStatus.CANCELLED, source, "PRIVATE_REASON");
    assertEquals(source, cancelled.cancellationSource());
    assertNull(cancelled.rejectionReason());
  }

  @Test
  void anUnknownSourceOrABlankReasonIsDropped() {
    assertNull(entry(OrderStatus.CANCELLED, "ADMIN", "x").cancellationSource());
    assertNull(entry(OrderStatus.CANCELLED, null, "x").rejectionReason());
    assertNull(entry(OrderStatus.CANCELLED, "WORKER", "   ").rejectionReason());
  }

  @ParameterizedTest
  @ValueSource(strings = {"DELIVERED", "NOT_COLLECTED"})
  void finishedOrdersThatAreNotCancelledHaveNeitherSourceNorReason(String status) {
    var finished = entry(OrderStatus.valueOf(status), "WORKER", "PRIVATE_REASON");
    assertNull(finished.cancellationSource());
    assertNull(finished.rejectionReason());
  }

  @Test
  void theShortConstructorHasNoCancellationDetails() {
    var legacy =
        new WorkerHistory.Entry(
            UUID.randomUUID(),
            null,
            OrderStatus.CANCELLED,
            Instant.parse("2026-11-20T17:00:00Z"),
            new BigDecimal("1.00"),
            List.of());
    assertNull(legacy.cancellationSource());
    assertNull(legacy.rejectionReason());
  }
}

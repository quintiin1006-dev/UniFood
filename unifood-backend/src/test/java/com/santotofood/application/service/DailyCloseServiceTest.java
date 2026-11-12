package com.santotofood.application.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

import com.santotofood.application.port.in.CloseStaleOrdersUseCase.ClosedOrders;
import com.santotofood.application.port.out.StaleOrderClosePort;
import java.time.Instant;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.SimpleTransactionStatus;

class DailyCloseServiceTest {
  StaleOrderClosePort port;
  PlatformTransactionManager manager;

  @BeforeEach
  void setUp() {
    port = mock(StaleOrderClosePort.class);
    manager = mock(PlatformTransactionManager.class);
    when(manager.getTransaction(any())).thenAnswer(call -> new SimpleTransactionStatus());
  }

  DailyCloseService at(String instant) {
    return new DailyCloseService(port, () -> Instant.parse(instant), manager);
  }

  @Test
  void theDayStartsAtMidnightInBogotaAndTheClockStampsTheClose() {
    when(port.cancelStalePending(any(), any())).thenReturn(2);
    when(port.markStaleNotCollected(any(), any())).thenReturn(3);
    var now = "2026-11-20T17:00:00Z";
    assertEquals(new ClosedOrders(2, 3), at(now).closeStaleOrders());
    var dayStart = Instant.parse("2026-11-20T05:00:00Z");
    var inOrder = inOrder(port);
    inOrder.verify(port).cancelStalePending(dayStart, Instant.parse(now));
    inOrder.verify(port).markStaleNotCollected(dayStart, Instant.parse(now));
  }

  @Test
  void justAfterMidnightInBogotaTheBoundaryIsThatSameMorning() {
    // 00:30 in Bogota is still 05:30Z: the business day began half an hour earlier.
    at("2026-11-21T05:30:00Z").closeStaleOrders();
    verify(port)
        .cancelStalePending(
            Instant.parse("2026-11-21T05:00:00Z"), Instant.parse("2026-11-21T05:30:00Z"));
    // 23:30 in Bogota is already 04:30Z the next day, and still belongs to the 20th.
    clearInvocations(port);
    at("2026-11-21T04:30:00Z").closeStaleOrders();
    verify(port)
        .cancelStalePending(
            Instant.parse("2026-11-20T05:00:00Z"), Instant.parse("2026-11-21T04:30:00Z"));
  }

  @Test
  void bothWritesShareOneReadCommittedTransactionWithTheProjectTimeout() {
    at("2026-11-20T17:00:00Z").closeStaleOrders();
    var definition = ArgumentCaptor.forClass(TransactionDefinition.class);
    verify(manager, times(1)).getTransaction(definition.capture());
    assertEquals(
        TransactionDefinition.ISOLATION_READ_COMMITTED, definition.getValue().getIsolationLevel());
    assertEquals(15, definition.getValue().getTimeout());
    assertFalse(definition.getValue().isReadOnly());
    verify(manager).commit(any());
  }
}

package com.santotofood.application.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.santotofood.application.exception.OrderNoticeException;
import com.santotofood.application.model.OrderNoticeKind;
import com.santotofood.application.port.out.OrderNoticePort;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** The flag gates writes and reads; the 20-notice, 7-day window is applied here. */
class OrderNoticeServiceTest {
  final OrderAuthorizationService authorization = mock(OrderAuthorizationService.class);
  final OrderNoticePort port = mock(OrderNoticePort.class);
  final Instant now = Instant.parse("2026-11-22T17:00:00Z");
  final UUID user = UUID.randomUUID();
  final UUID order = UUID.randomUUID();

  OrderNoticeService service(boolean enabled) {
    return new OrderNoticeService(() -> enabled, authorization, port, () -> now);
  }

  @Test
  void flagOffWritesNothingAndBothEndpointsAreDisabled() {
    var off = service(false);
    when(authorization.client(user)).thenReturn(true);
    off.record(order, OrderNoticeKind.READY, 0, now);
    verifyNoInteractions(port);
    assertEquals(
        OrderNoticeException.Kind.DISABLED,
        assertThrows(OrderNoticeException.class, () -> off.recentNotices(user)).kind());
    assertEquals(
        OrderNoticeException.Kind.DISABLED,
        assertThrows(OrderNoticeException.class, () -> off.markNoticesRead(user)).kind());
    verifyNoInteractions(port);
  }

  @Test
  void flagOnReadsTheLastSevenDaysCappedAtTwenty() {
    when(authorization.client(user)).thenReturn(true);
    when(port.findRecent(any(), any(), anyInt())).thenReturn(List.of());
    service(true).recentNotices(user);
    verify(port).findRecent(user, Instant.parse("2026-11-15T17:00:00Z"), 20);
  }

  @Test
  void aNonClientIsRefusedBeforeTouchingTheStore() {
    when(authorization.client(user)).thenReturn(false);
    var on = service(true);
    assertEquals(
        OrderNoticeException.Kind.FORBIDDEN,
        assertThrows(OrderNoticeException.class, () -> on.recentNotices(user)).kind());
    assertThrows(OrderNoticeException.class, () -> on.markNoticesRead(user));
    verifyNoInteractions(port);
  }

  @Test
  void aStoreFailureWhileRecordingIsSwallowed() {
    doThrow(new IllegalStateException("down")).when(port).record(any(), any(), anyInt(), any());
    assertDoesNotThrow(() -> service(true).record(order, OrderNoticeKind.CALLED, 0, now));
    verify(port).record(order, OrderNoticeKind.CALLED, 0, now);
  }
}

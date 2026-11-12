package com.santotofood.application.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.*;

import com.santotofood.application.exception.ClientOrderException;
import com.santotofood.application.model.ClientOrder;
import com.santotofood.application.port.out.ClientOrderQueryPort;
import com.santotofood.application.port.out.ClientOrderQueryPort.CurrentTag;
import com.santotofood.application.port.out.ClientOrderQueryPort.HistoryRow;
import com.santotofood.application.port.out.ClientOrderQueryPort.Position;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.dao.QueryTimeoutException;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.SimpleTransactionStatus;

class ClientOrderQueryServiceTest {
  static final UUID USER = UUID.randomUUID();
  static final UUID CLIENT = UUID.randomUUID();
  static final UUID ORDER = UUID.randomUUID();
  static final Instant NOW = Instant.parse("2026-11-20T17:00:00.123456Z");

  ClientOrderQueryPort port;
  PlatformTransactionManager manager;
  ClientOrderQueryService service;

  @BeforeEach
  void setUp() {
    port = mock(ClientOrderQueryPort.class);
    manager = mock(PlatformTransactionManager.class);
    when(manager.getTransaction(any())).thenAnswer(call -> new SimpleTransactionStatus());
    service = new ClientOrderQueryService(port, manager);
    when(port.findClient(USER)).thenReturn(Optional.of(CLIENT));
  }

  static ClientOrder order(String status) {
    return new ClientOrder(
        ORDER,
        status,
        BigDecimal.TEN,
        null,
        NOW,
        List.of(),
        new ClientOrder.Cafeteria(UUID.randomUUID(), "Cafetería Central"),
        null,
        null,
        new ClientOrder.Timeline(NOW, null, 0, null, null, null, null),
        null);
  }

  static CurrentTag tag(String status, long version) {
    return new CurrentTag(ORDER, status, NOW, version);
  }

  static HistoryRow row(Instant createdAt, int products, List<String> names, List<Integer> units) {
    return new HistoryRow(
        UUID.randomUUID(),
        "DELIVERED",
        BigDecimal.TEN,
        createdAt,
        "Cafetería Central",
        units.stream().mapToInt(Integer::intValue).sum(),
        products,
        names,
        units);
  }

  @Test
  void readsRunInOneReadOnlyRepeatableReadTransactionWithTheProjectTimeout() {
    when(port.findCurrentTag(USER)).thenReturn(Optional.of(new CurrentTag(null, null, null, 0)));
    service.getOwnCurrentOrder(USER, null);
    var definition = ArgumentCaptor.forClass(TransactionDefinition.class);
    verify(manager).getTransaction(definition.capture());
    assertTrue(definition.getValue().isReadOnly());
    assertEquals(
        TransactionDefinition.ISOLATION_REPEATABLE_READ, definition.getValue().getIsolationLevel());
    assertEquals(15, definition.getValue().getTimeout());
  }

  @Test
  void aMatchingTagSkipsTheOrderAndItsItems() {
    when(port.findCurrentTag(USER)).thenReturn(Optional.of(tag("PENDING", 3)));
    when(port.findOwnOrder(USER, ORDER)).thenReturn(Optional.of(order("PENDING")));
    var first = service.getOwnCurrentOrder(USER, null);
    assertFalse(first.notModified());
    assertEquals("PENDING", first.order().orElseThrow().status());
    clearInvocations(port);

    for (String header :
        List.of(first.etag(), "W/" + first.etag(), "\"x\", " + first.etag(), "*")) {
      var again = service.getOwnCurrentOrder(USER, header);
      assertTrue(again.notModified(), header);
      assertEquals(first.etag(), again.etag());
      assertTrue(again.order().isEmpty());
    }
    verify(port, times(4)).findCurrentTag(USER);
    verify(port, never()).findOwnOrder(any(), any());
  }

  @Test
  void aStaleTagLoadsTheOrderWithTheSessionUser() {
    when(port.findCurrentTag(USER)).thenReturn(Optional.of(tag("PREPARING", 4)));
    when(port.findOwnOrder(USER, ORDER)).thenReturn(Optional.of(order("PREPARING")));
    var current = service.getOwnCurrentOrder(USER, "\"stale\"");
    assertFalse(current.notModified());
    assertEquals("PREPARING", current.order().orElseThrow().status());
  }

  @Test
  void withoutAnActiveOrderTheTagIsStableAndNothingElseIsRead() {
    when(port.findCurrentTag(USER)).thenReturn(Optional.of(new CurrentTag(null, null, null, 0)));
    var none = service.getOwnCurrentOrder(USER, null);
    assertTrue(none.order().isEmpty());
    assertFalse(none.notModified());
    assertEquals(none.etag(), service.getOwnCurrentOrder(USER, null).etag());
    verify(port, never()).findOwnOrder(any(), any());
  }

  @Test
  void statusUpdatedAtAndVersionAllMoveTheTag() {
    var base = ClientOrderQueryService.etag(tag("PENDING", 1));
    var none = ClientOrderQueryService.etag(new CurrentTag(null, null, null, 0));
    var tags =
        List.of(
            base,
            none,
            ClientOrderQueryService.etag(tag("PREPARING", 1)),
            ClientOrderQueryService.etag(tag("PENDING", 2)),
            ClientOrderQueryService.etag(new CurrentTag(ORDER, "PENDING", NOW.plusNanos(1000), 1)),
            ClientOrderQueryService.etag(new CurrentTag(UUID.randomUUID(), "PENDING", NOW, 1)));
    assertEquals(tags.size(), tags.stream().distinct().count());
    assertTrue(base.matches("\"[0-9a-f]{32}\""), base);
  }

  @Test
  void aMissingClientRowIsForbiddenBeforeTheRequestIsValidated() {
    when(port.findClient(USER)).thenReturn(Optional.empty());
    when(port.findCurrentTag(USER)).thenReturn(Optional.empty());
    assertEquals(
        "FORBIDDEN",
        assertThrows(ClientOrderException.class, () -> service.getOwnCurrentOrder(USER, null))
            .getCode());
    assertEquals(
        "FORBIDDEN",
        assertThrows(
                ClientOrderException.class, () -> service.getOwnOrderHistory(USER, "%%%", "999"))
            .getCode());
    assertEquals(
        "FORBIDDEN",
        assertThrows(ClientOrderException.class, () -> service.getOwnOrder(USER, ORDER)).getCode());
    verify(port, never()).findHistory(any(), any(), anyInt());
    verify(port, never()).findOwnOrder(any(), any());
  }

  @Test
  void aForeignOrMissingOrderIsNotFound() {
    when(port.findOwnOrder(USER, ORDER)).thenReturn(Optional.empty());
    var refused = assertThrows(ClientOrderException.class, () -> service.getOwnOrder(USER, ORDER));
    assertEquals("ORDER_NOT_FOUND", refused.getCode());
    assertEquals(ClientOrderException.Kind.NOT_FOUND, refused.getKind());
  }

  @Test
  void historyReadsOneExtraRowToKnowAboutTheNextPage() {
    var rows = new ArrayList<HistoryRow>();
    for (int i = 0; i < 4; i++)
      rows.add(row(NOW.minusSeconds(i), 1, List.of("Jugo natural"), List.of(1)));
    when(port.findHistory(eq(CLIENT), isNull(), eq(4))).thenReturn(rows);
    var page = service.getOwnOrderHistory(USER, null, "3");
    assertEquals(3, page.orders().size());
    assertNotNull(page.nextCursor());

    // The cursor names the last row shown, to the microsecond.
    when(port.findHistory(eq(CLIENT), any(Position.class), eq(4))).thenReturn(rows.subList(3, 4));
    var next = service.getOwnOrderHistory(USER, page.nextCursor(), "3");
    var position = ArgumentCaptor.forClass(Position.class);
    verify(port, times(2)).findHistory(eq(CLIENT), position.capture(), eq(4));
    assertNull(position.getAllValues().getFirst());
    assertEquals(rows.get(2).createdAt(), position.getValue().createdAt());
    assertEquals(rows.get(2).id(), position.getValue().id());
    assertEquals(1, next.orders().size());
    assertNull(next.nextCursor());
  }

  @Test
  void historyLimitDefaultsTo20AndOnly1To50AreAccepted() {
    when(port.findHistory(any(), any(), anyInt())).thenReturn(List.of());
    service.getOwnOrderHistory(USER, null, null);
    service.getOwnOrderHistory(USER, "", "");
    verify(port, times(2)).findHistory(CLIENT, null, 21);
    service.getOwnOrderHistory(USER, null, "50");
    verify(port).findHistory(CLIENT, null, 51);
    for (String limit : List.of("0", "51", "-1", "abc", "1.5", "007", " 5"))
      assertEquals(
          "INVALID_ORDER_REQUEST",
          assertThrows(
                  ClientOrderException.class, () -> service.getOwnOrderHistory(USER, null, limit))
              .getCode(),
          limit);
  }

  @Test
  void aCursorThatDoesNotDecodeExactlyIsTheOrderRequestCode() {
    var real =
        ClientOrderQueryService.Cursor.encode(row(NOW, 1, List.of("Jugo natural"), List.of(1)));
    var decoded = ClientOrderQueryService.Cursor.decode(real);
    assertEquals(NOW, decoded.createdAt());
    for (String cursor :
        List.of(
            "x y", real + "A", real.substring(1), "A".repeat(97), "YzE6MTox", real.toLowerCase()))
      assertEquals(
          "INVALID_ORDER_REQUEST",
          assertThrows(
                  ClientOrderException.class, () -> service.getOwnOrderHistory(USER, cursor, null))
              .getCode(),
          cursor);
    verify(port, never()).findHistory(any(), any(), anyInt());
  }

  @Test
  void theSummaryNamesTwoProductsAndCountsTheRemainingDistinctOnes() {
    assertEquals(
        "2× Jugo natural",
        ClientOrderQueryService.summary(row(NOW, 1, List.of("Jugo natural"), List.of(2))));
    assertEquals(
        "1× Arepa, 3× Jugo natural",
        ClientOrderQueryService.summary(
            row(NOW, 2, List.of("Arepa", "Jugo natural"), List.of(1, 3))));
    // Five distinct products with ten units in all: «y 3 más», never «y 6 más».
    assertEquals(
        "1× Arepa, 3× Jugo natural y 3 más",
        ClientOrderQueryService.summary(
            row(NOW, 5, List.of("Arepa", "Jugo natural"), List.of(1, 3))));
    assertEquals("", ClientOrderQueryService.summary(row(NOW, 0, List.of(), List.of())));
  }

  @Test
  void aTemporaryDatabaseFailureIsTheRetryable503Code() {
    when(port.findCurrentTag(USER)).thenThrow(new QueryTimeoutException("PRIVATE"));
    var refused =
        assertThrows(ClientOrderException.class, () -> service.getOwnCurrentOrder(USER, null));
    assertEquals("ORDER_TEMPORARILY_UNAVAILABLE", refused.getCode());
    assertFalse(refused.getMessage().contains("PRIVATE"));
  }
}

package com.santotofood.application.port.out;

import com.santotofood.application.model.ClientOrder;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/** Client order reads. Every query is filtered in SQL by the session's user or client. */
public interface ClientOrderQueryPort {

  /** Empty without an active account and client row; otherwise the active order's tag, if any. */
  Optional<CurrentTag> findCurrentTag(UUID userId);

  Optional<ClientOrder> findOwnOrder(UUID userId, UUID orderId);

  /** The client row of an active account. */
  Optional<UUID> findClient(UUID userId);

  /** Newest first, strictly after {@code after} when given. */
  List<HistoryRow> findHistory(UUID clientId, Position after, int limit);

  /** {@code orderId} is null when the client has no active order. */
  record CurrentTag(UUID orderId, String status, Instant updatedAt, long version) {}

  record Position(Instant createdAt, UUID id) {}

  /** {@code firstNames} and {@code firstQuantities}: the first two products by name. */
  record HistoryRow(
      UUID id,
      String status,
      BigDecimal total,
      Instant createdAt,
      String cafeteriaName,
      int units,
      int products,
      List<String> firstNames,
      List<Integer> firstQuantities) {}
}

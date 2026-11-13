package com.santotofood.adapter.in.web.dto;

import com.santotofood.domain.model.OrderStatus;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Worker order: name, institutional code and client type, never the document (B20). {@code
 * requestedPickupAt} is null for "as soon as possible". {@code calledAt}, {@code reminderCount} and
 * {@code lastRemindedAt} let the panel show the reminders and enable "No recogido". {@code note} is
 * the client's free text (021), null when there is none; the panel shows it as plain text.
 */
public record OrderResponse(
    UUID id,
    UUID cafeteriaId,
    UUID clientId,
    String clientName,
    String clientCode,
    String clientType,
    OrderStatus status,
    BigDecimal total,
    Instant createdAt,
    Instant updatedAt,
    Instant deliveredAt,
    List<OrderItemResponse> items,
    Instant requestedPickupAt,
    Instant calledAt,
    int reminderCount,
    Instant lastRemindedAt,
    String note) {}

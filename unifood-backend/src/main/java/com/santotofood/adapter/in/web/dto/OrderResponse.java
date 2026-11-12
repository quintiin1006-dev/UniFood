package com.santotofood.adapter.in.web.dto;

import com.santotofood.domain.model.OrderStatus;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Worker order: name, institutional code and client type, never the document (B20). {@code
 * requestedPickupAt} is null for "as soon as possible". {@code calledAt}, {@code reminderCount} and
 * {@code lastRemindedAt} let the panel show the reminders and enable "No recogido".
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
    Instant lastRemindedAt) {}

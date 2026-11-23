package com.santotofood.adapter.in.web.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.santotofood.application.model.OrderDailyMenu;
import com.santotofood.domain.model.OrderStatus;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Worker order: name, institutional code and client type, never the document (B20). {@code
 * requestedPickupAt} is null for "as soon as possible". {@code calledAt}, {@code reminderCount} and
 * {@code lastRemindedAt} let the panel show the reminders and enable "No recogido". {@code note} is
 * the client's free text (021), null when there is none; the panel shows it as plain text. {@code
 * maxReminders} is the server limit, so the panel never hardcodes it. {@code dailyMenu} is the
 * plate copied into the order (docs/propuesta-menu-dinamico.md, section 3.5), left out when there
 * is none. {@code productsSubtotal} and {@code serviceFee} (033) let the panel show «Total a
 * cobrar» with its breakdown: total = productsSubtotal + serviceFee, all from the server.
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
    String note,
    int maxReminders,
    @JsonInclude(JsonInclude.Include.NON_NULL) OrderDailyMenu dailyMenu,
    BigDecimal productsSubtotal,
    BigDecimal serviceFee) {}

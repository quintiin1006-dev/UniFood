package com.santotofood.adapter.in.web.dto;

import com.santotofood.domain.model.OrderStatus;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record OrderResponse(
        UUID id,
        UUID cafeteriaId,
        UUID clientId,
        String clientName,
        String clientDocument,
        OrderStatus status,
        BigDecimal total,
        Instant cancellationDeadline,
        Instant createdAt,
        Instant updatedAt,
        List<OrderItemResponse> items
) {
}
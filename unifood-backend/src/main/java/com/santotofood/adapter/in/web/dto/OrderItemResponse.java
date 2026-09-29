package com.santotofood.adapter.in.web.dto;

import java.math.BigDecimal;
import java.util.UUID;

public record OrderItemResponse(
        UUID id,
        UUID orderId,
        UUID lunchId,
        String lunchName,
        BigDecimal unitPrice,
        int quantity,
        String beverageChoice,
        String note,
        BigDecimal subtotal
) {
}
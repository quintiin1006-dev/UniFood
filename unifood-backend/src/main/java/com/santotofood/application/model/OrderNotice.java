package com.santotofood.application.model;

import java.time.Instant;
import java.util.UUID;

/** One notice of the inbox. {@code orderActive}: the order can still be followed in Mi pedido. */
public record OrderNotice(
    UUID id,
    OrderNoticeKind kind,
    int sequence,
    UUID orderId,
    boolean orderActive,
    Instant createdAt,
    boolean read) {}

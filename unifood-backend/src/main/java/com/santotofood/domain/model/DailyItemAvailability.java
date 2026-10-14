package com.santotofood.domain.model;

import java.time.Instant;
import java.util.UUID;

/** Daily flag, independent of catalog stock/activity; an absent row means unavailable. */
public record DailyItemAvailability(
    UUID cafeteriaId,
    UUID itemId,
    BusinessDate businessDate,
    boolean available,
    Instant createdAt,
    Instant updatedAt) {}

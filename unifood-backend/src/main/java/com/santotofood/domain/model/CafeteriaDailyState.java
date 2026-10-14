package com.santotofood.domain.model;

import java.time.Instant;
import java.util.UUID;

/** An explicitly stored day state; an absent row means closed. */
public record CafeteriaDailyState(
    UUID cafeteriaId,
    BusinessDate businessDate,
    boolean open,
    Instant createdAt,
    Instant updatedAt) {}

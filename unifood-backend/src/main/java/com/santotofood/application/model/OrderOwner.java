package com.santotofood.application.model;

import java.util.UUID;

/** Current owner identity; null when the order has no linked client. */
public record OrderOwner(UUID userId) {}

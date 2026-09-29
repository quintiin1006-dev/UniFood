package com.santotofood.adapter.in.web.dto;

import java.time.OffsetDateTime;
import java.util.UUID;

public record InstitutionResponse(
        UUID id,
        String name,
        String emailDomain,
        String brandName,
        boolean active,
        OffsetDateTime createdAt,
        OffsetDateTime updatedAt
) {
}
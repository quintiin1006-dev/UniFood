package com.santotofood.adapter.in.web.error;

import java.time.Instant;

public record ApiErrorResponse(
        int status,
        String code,
        String message,
        Instant timestamp,
        String path
) {
}
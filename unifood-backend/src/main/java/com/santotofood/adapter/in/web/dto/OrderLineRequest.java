package com.santotofood.adapter.in.web.dto;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.UUID;

public record OrderLineRequest(
    @NotNull(message = "El plato es obligatorio") UUID lunchId,
    @Min(value = 1, message = "La cantidad debe ser mayor que cero") int quantity,
    @Size(max = 200, message = "Las observaciones no pueden superar 200 caracteres") String note) {}

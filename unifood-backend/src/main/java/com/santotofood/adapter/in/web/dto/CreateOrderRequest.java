package com.santotofood.adapter.in.web.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import java.util.List;

public record CreateOrderRequest(
    @NotEmpty(message = "El carrito no puede estar vacío")
        List<@NotNull(message = "Cada línea debe indicar un plato") @Valid OrderLineRequest>
            items) {}

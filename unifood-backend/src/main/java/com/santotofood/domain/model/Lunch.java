package com.santotofood.domain.model;

import lombok.Getter;

import java.math.BigDecimal;
import java.util.UUID;

@Getter
public class Lunch {

    private UUID id;
    private UUID cafeteriaId;

    private String name;
    private String description;

    private BigDecimal price;

    private String imageUrl;

    private int stock;

    private boolean active;

    // Constructor explícito para inicializar las propiedades
    // con las que se crea el almuerzo.
    public Lunch(
            UUID id,
            UUID cafeteriaId,
            String name,
            String description,
            BigDecimal price,
            String imageUrl,
            int stock
    ) {
        if (price == null || price.compareTo(BigDecimal.ZERO) <= 0) {
            throw new IllegalArgumentException(
                    "El precio debe ser mayor que cero"
            );
        }

        if (stock < 0) {
            throw new IllegalArgumentException(
                    "El stock no puede ser negativo"
            );
        }

        this.id = id;
        this.cafeteriaId = cafeteriaId;
        this.name = name;
        this.description = description;
        this.price = price;
        this.imageUrl = imageUrl;
        this.stock = stock;

        this.active = true;
    }

    public void decreaseStock(int quantity) {

        if (quantity <= 0) {
            throw new IllegalArgumentException(
                    "La cantidad debe ser mayor que cero"
            );
        }

        if (stock < quantity) {
            throw new IllegalStateException(
                    "No hay suficiente stock disponible"
            );
        }

        stock -= quantity;
    }

    public void increaseStock(int quantity) {

        if (quantity <= 0) {
            throw new IllegalArgumentException(
                    "La cantidad debe ser mayor que cero"
            );
        }

        stock += quantity;
    }

    public void activate() {
        this.active = true;
    }

    public void deactivate() {
        this.active = false;
    }

    public boolean isAvailable() {
        return active && stock > 0;
    }
}
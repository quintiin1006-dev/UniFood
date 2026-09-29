package com.santotofood.domain.model;

import lombok.Getter;

import java.math.BigDecimal;
import java.util.UUID;

@Getter
public class OrderItem {

    private UUID id;
    private UUID orderId;
    private UUID lunchId;

    private String lunchName;
    private BigDecimal unitPrice;

    private int quantity;

    private String beverageChoice;
    private String note;

    private BigDecimal subtotal;

    // Constructor explícito para inicializar las propiedades
    // con las que se crea el detalle de la orden.

    public OrderItem(
            UUID id,
            UUID orderId,
            UUID lunchId,
            String lunchName,
            BigDecimal unitPrice,
            int quantity,
            String beverageChoice,
            String note
    ) {
        if (unitPrice == null || unitPrice.compareTo(BigDecimal.ZERO) <= 0) {
            throw new IllegalArgumentException(
                    "El precio unitario debe ser mayor que cero"
            );
        }

        if (quantity <= 0) {
            throw new IllegalArgumentException(
                    "La cantidad debe ser mayor que cero"
            );
        }

        this.id = id;
        this.orderId = orderId;
        this.lunchId = lunchId;
        this.lunchName = lunchName;
        this.unitPrice = unitPrice;
        this.quantity = quantity;
        this.beverageChoice = beverageChoice;
        this.note = note;

        this.subtotal = unitPrice.multiply(
                BigDecimal.valueOf(quantity)
        );
    }

    // Reconstruye un OrderItem existente desde la base de datos.
    public static OrderItem reconstitute(
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
        OrderItem item = new OrderItem(
                id,
                orderId,
                lunchId,
                lunchName,
                unitPrice,
                quantity,
                beverageChoice,
                note
        );

        item.subtotal = subtotal;

        return item;
    }
}
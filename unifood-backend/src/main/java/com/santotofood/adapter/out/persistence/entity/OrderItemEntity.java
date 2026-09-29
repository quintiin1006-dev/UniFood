package com.santotofood.adapter.out.persistence.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.util.UUID;

@Entity
@Table(name = "order_items")
@Getter
@NoArgsConstructor
@AllArgsConstructor
public class OrderItemEntity {

    @Id
    @Column(name = "id", nullable = false)
    private UUID id;

    @Column(name = "order_id", nullable = false)
    private UUID orderId;

    @Column(name = "lunch_id", nullable = false)
    private UUID lunchId;

    @Column(name = "lunch_name", nullable = false, length = 150)
    private String lunchName;

    @Column(name = "unit_price", nullable = false, precision = 12, scale = 2)
    private BigDecimal unitPrice;

    @Column(name = "quantity", nullable = false)
    private Integer quantity;

    @Column(name = "beverage_choice", length = 100)
    private String beverageChoice;

    @Column(name = "note", length = 500)
    private String note;

    @Column(name = "subtotal", nullable = false, precision = 12, scale = 2)
    private BigDecimal subtotal;
}
package com.santotofood.adapter.out.persistence.entity;

import com.santotofood.domain.model.OrderStatus;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "orders", schema = "public")
public class OrderEntity {

    @Id
    @Column(name = "id", nullable = false)
    private UUID id;

    @Column(name = "cafeteria_id", nullable = false)
    private UUID cafeteriaId;

    @Column(name = "client_id")
    private UUID clientId;

    @Column(name = "client_name", nullable = false)
    private String clientName;

    @Column(name = "client_document")
    private String clientDocument;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.NAMED_ENUM)
    @Column(
            name = "status",
            nullable = false,
            columnDefinition = "order_status"
    )
    private OrderStatus status;

    @Column(name = "total", nullable = false)
    private BigDecimal total;

    @Column(name = "cancellation_deadline")
    private Instant cancellationDeadline;

    @Column(name = "called_at")
    private Instant calledAt;

    @Column(name = "reminder_count", nullable = false)
    private int reminderCount;

    @Column(name = "last_reminded_at")
    private Instant lastRemindedAt;

    @Column(name = "delivered_at")
    private Instant deliveredAt;

    @Column(name = "not_collected_at")
    private Instant notCollectedAt;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    public OrderEntity() {
    }

    public OrderEntity(
            UUID id,
            UUID cafeteriaId,
            UUID clientId,
            String clientName,
            String clientDocument,
            OrderStatus status,
            BigDecimal total,
            Instant cancellationDeadline,
            Instant calledAt,
            int reminderCount,
            Instant lastRemindedAt,
            Instant deliveredAt,
            Instant notCollectedAt,
            Instant createdAt,
            Instant updatedAt
    ) {
        this.id = id;
        this.cafeteriaId = cafeteriaId;
        this.clientId = clientId;
        this.clientName = clientName;
        this.clientDocument = clientDocument;
        this.status = status;
        this.total = total;
        this.cancellationDeadline = cancellationDeadline;
        this.calledAt = calledAt;
        this.reminderCount = reminderCount;
        this.lastRemindedAt = lastRemindedAt;
        this.deliveredAt = deliveredAt;
        this.notCollectedAt = notCollectedAt;
        this.createdAt = createdAt;
        this.updatedAt = updatedAt;
    }

    public UUID getId() {
        return id;
    }

    public void setId(UUID id) {
        this.id = id;
    }

    public UUID getCafeteriaId() {
        return cafeteriaId;
    }

    public void setCafeteriaId(UUID cafeteriaId) {
        this.cafeteriaId = cafeteriaId;
    }

    public UUID getClientId() {
        return clientId;
    }

    public void setClientId(UUID clientId) {
        this.clientId = clientId;
    }

    public String getClientName() {
        return clientName;
    }

    public void setClientName(String clientName) {
        this.clientName = clientName;
    }

    public String getClientDocument() {
        return clientDocument;
    }

    public void setClientDocument(String clientDocument) {
        this.clientDocument = clientDocument;
    }

    public OrderStatus getStatus() {
        return status;
    }

    public void setStatus(OrderStatus status) {
        this.status = status;
    }

    public BigDecimal getTotal() {
        return total;
    }

    public void setTotal(BigDecimal total) {
        this.total = total;
    }

    public Instant getCancellationDeadline() {
        return cancellationDeadline;
    }

    public void setCancellationDeadline(Instant cancellationDeadline) {
        this.cancellationDeadline = cancellationDeadline;
    }

    public Instant getCalledAt() {
        return calledAt;
    }

    public void setCalledAt(Instant calledAt) {
        this.calledAt = calledAt;
    }

    public int getReminderCount() {
        return reminderCount;
    }

    public void setReminderCount(int reminderCount) {
        this.reminderCount = reminderCount;
    }

    public Instant getLastRemindedAt() {
        return lastRemindedAt;
    }

    public void setLastRemindedAt(Instant lastRemindedAt) {
        this.lastRemindedAt = lastRemindedAt;
    }

    public Instant getDeliveredAt() {
        return deliveredAt;
    }

    public void setDeliveredAt(Instant deliveredAt) {
        this.deliveredAt = deliveredAt;
    }

    public Instant getNotCollectedAt() {
        return notCollectedAt;
    }

    public void setNotCollectedAt(Instant notCollectedAt) {
        this.notCollectedAt = notCollectedAt;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(Instant createdAt) {
        this.createdAt = createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }

    public void setUpdatedAt(Instant updatedAt) {
        this.updatedAt = updatedAt;
    }
}
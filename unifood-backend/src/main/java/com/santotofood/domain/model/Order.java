package com.santotofood.domain.model;

import com.santotofood.domain.exception.CancellationDeadlineExpiredException;
import com.santotofood.domain.exception.InvalidOrderStateException;
import com.santotofood.domain.exception.NotCollectedRequirementsException;
import com.santotofood.domain.exception.ReminderLimitReachedException;
import com.santotofood.domain.exception.ReminderTooEarlyException;
import lombok.Getter;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Getter
public class Order {

    private static final int MAX_REMINDERS = 3;

    private static final Duration MIN_TIME_BETWEEN_REMINDERS =
            Duration.ofMinutes(5);

    private UUID id;
    private UUID cafeteriaId;
    private UUID clientId;

    private String clientName;
    private String clientDocument;

    private OrderStatus status;

    private BigDecimal total;

    private Instant cancellationDeadline;

    private Instant calledAt;
    private int reminderCount;
    private Instant lastRemindedAt;
    private Instant deliveredAt;
    private Instant notCollectedAt;

    private Instant createdAt;
    private Instant updatedAt;

    private List<OrderItem> items;

    public Order(
            UUID id,
            UUID cafeteriaId,
            UUID clientId,
            String clientName,
            String clientDocument,
            BigDecimal total,
            Instant cancellationDeadline,
            Instant createdAt
    ) {
        requireInstant(createdAt);

        this.id = id;
        this.cafeteriaId = cafeteriaId;
        this.clientId = clientId;
        this.clientName = clientName;
        this.clientDocument = clientDocument;
        this.status = OrderStatus.PENDING;
        this.total = total;
        this.cancellationDeadline = cancellationDeadline;

        this.calledAt = null;
        this.reminderCount = 0;
        this.lastRemindedAt = null;
        this.deliveredAt = null;
        this.notCollectedAt = null;

        this.createdAt = createdAt;
        this.updatedAt = createdAt;

        this.items = new ArrayList<>();
    }

    public void prepare(Instant now) {
        requireInstant(now);

        if (status != OrderStatus.PENDING) {
            throw new InvalidOrderStateException(
                    "Solo un pedido pendiente puede pasar a preparación"
            );
        }

        status = OrderStatus.PREPARING;
        updatedAt = now;
    }

    public void markReady(Instant now) {
        requireInstant(now);

        if (status != OrderStatus.PREPARING) {
            throw new InvalidOrderStateException(
                    "Solo un pedido en preparación puede marcarse como listo"
            );
        }

        status = OrderStatus.READY;
        updatedAt = now;
    }

    public void callStudent(Instant now) {
        requireInstant(now);

        if (status != OrderStatus.READY) {
            throw new InvalidOrderStateException(
                    "Solo un pedido listo puede llamar al estudiante"
            );
        }

        status = OrderStatus.CALLED;
        calledAt = now;
        reminderCount = 0;
        lastRemindedAt = null;
        updatedAt = now;
    }

    public void remindStudent(Instant now) {
        requireInstant(now);

        if (status != OrderStatus.CALLED) {
            throw new InvalidOrderStateException(
                    "Solo un pedido llamado puede recibir un recordatorio"
            );
        }

        if (reminderCount >= MAX_REMINDERS) {
            throw new ReminderLimitReachedException();
        }

        Instant referenceTime =
                lastRemindedAt != null
                        ? lastRemindedAt
                        : calledAt;

        /*
         * Un pedido CALLED siempre debe tener calledAt.
         *
         * Si esta condición falla, no estamos ante una acción
         * inválida del usuario sino ante un estado interno
         * inconsistente.
         */
        if (referenceTime == null) {
            throw new IllegalStateException(
                    "Inconsistencia interna: un pedido llamado debe tener calledAt"
            );
        }

        if (now.isBefore(referenceTime)) {
            throw new IllegalStateException(
                    "Inconsistencia temporal: la fecha de la operación no puede ser anterior al último llamado o recordatorio"
            );
        }

        Duration elapsed =
                Duration.between(referenceTime, now);

        if (elapsed.compareTo(MIN_TIME_BETWEEN_REMINDERS) < 0) {
            throw new ReminderTooEarlyException();
        }

        reminderCount++;
        lastRemindedAt = now;
        updatedAt = now;
    }

    public void deliver(Instant now) {
        requireInstant(now);

        if (status != OrderStatus.CALLED) {
            throw new InvalidOrderStateException(
                    "Solo un pedido llamado puede marcarse como entregado"
            );
        }

        status = OrderStatus.DELIVERED;
        deliveredAt = now;
        updatedAt = now;
    }

    public void markNotCollected(Instant now) {
        requireInstant(now);

        if (status != OrderStatus.CALLED) {
            throw new InvalidOrderStateException(
                    "Solo un pedido llamado puede marcarse como no recogido"
            );
        }

        if (reminderCount < MAX_REMINDERS) {
            throw new NotCollectedRequirementsException();
        }

        status = OrderStatus.NOT_COLLECTED;
        notCollectedAt = now;
        updatedAt = now;
    }

    public void cancel(Instant now) {
        requireInstant(now);

        if (status != OrderStatus.PENDING) {
            throw new InvalidOrderStateException(
                    "Solo un pedido pendiente puede cancelarse"
            );
        }

        if (cancellationDeadline != null
                && now.isAfter(cancellationDeadline)) {

            throw new CancellationDeadlineExpiredException();
        }

        status = OrderStatus.CANCELLED;
        updatedAt = now;
    }

    public static Order reconstitute(
            UUID id,
            UUID cafeteriaId,
            UUID clientId,
            String clientName,
            String clientDocument,
            OrderStatus status,
            BigDecimal total,
            Instant cancellationDeadline,
            Instant createdAt,
            Instant updatedAt
    ) {
        Order order = new Order(
                id,
                cafeteriaId,
                clientId,
                clientName,
                clientDocument,
                total,
                cancellationDeadline,
                createdAt
        );

        order.status = status;
        order.updatedAt = updatedAt;

        return order;
    }

    public static Order reconstitute(
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
        Order order = new Order(
                id,
                cafeteriaId,
                clientId,
                clientName,
                clientDocument,
                total,
                cancellationDeadline,
                createdAt
        );

        order.status = status;
        order.calledAt = calledAt;
        order.reminderCount = reminderCount;
        order.lastRemindedAt = lastRemindedAt;
        order.deliveredAt = deliveredAt;
        order.notCollectedAt = notCollectedAt;
        order.updatedAt = updatedAt;

        return order;
    }

    public void setItems(List<OrderItem> items) {
        this.items = items != null
                ? new ArrayList<>(items)
                : new ArrayList<>();
    }

    private static void requireInstant(Instant instant) {
        if (instant == null) {
            throw new IllegalArgumentException(
                    "La fecha de la operación es obligatoria"
            );
        }
    }
}
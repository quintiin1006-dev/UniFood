package com.santotofood.domain.model;

import com.santotofood.domain.exception.InvalidOrderStateException;
import com.santotofood.domain.exception.InvalidRejectionReasonException;
import com.santotofood.domain.exception.NotCollectedRequirementsException;
import com.santotofood.domain.exception.OrderConflictException;
import com.santotofood.domain.exception.ReminderLimitReachedException;
import com.santotofood.domain.exception.ReminderTooEarlyException;
import com.santotofood.shared.error.ErrorCode;
import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import lombok.Getter;

@Getter
public class Order {

  private Long revision;
  private boolean cancelledByClient;

  /** Who ended a cancelled order and why (021). Immutable once set; never shown to the worker. */
  private String cancellationSource;

  private String rejectionReason;
  private UUID rejectedBy;

  /** Restore only when reconstituting an aggregate from persistence. */
  public void restoreConcurrencyState(Long revision, boolean cancelledByClient) {
    this.revision = revision;
    this.cancelledByClient = cancelledByClient;
  }

  /** Restore only when reconstituting an aggregate from persistence. */
  public void restoreCancellation(
      String cancellationSource, String rejectionReason, UUID rejectedBy) {
    this.cancellationSource = cancellationSource;
    this.rejectionReason = rejectionReason;
    this.rejectedBy = rejectedBy;
  }

  /** Optional pickup time the client asked for (023); informative, it never orders the queue. */
  private Instant requestedPickupAt;

  /** Restore only when reconstituting an aggregate from persistence. */
  public void restoreRequestedPickupAt(Instant requestedPickupAt) {
    this.requestedPickupAt = requestedPickupAt;
  }

  public static final int MIN_REJECTION_REASON_LENGTH = 3;
  public static final int MAX_REJECTION_REASON_LENGTH = 200;

  private static final int MAX_REMINDERS = 3;

  private static final Duration MIN_TIME_BETWEEN_REMINDERS = Duration.ofMinutes(5);

  private UUID id;
  private UUID cafeteriaId;
  private UUID clientId;

  private String clientName;

  /** Institutional code and client type the worker sees; never the client's document (B20). */
  private String clientCode;

  private String clientType;

  private OrderStatus status;

  private BigDecimal total;

  private Instant calledAt;
  private int reminderCount;
  private Instant lastRemindedAt;
  private Instant deliveredAt;
  private Instant notCollectedAt;
  private Instant cancelledAt;

  private Instant createdAt;
  private Instant updatedAt;

  private List<OrderItem> items;

  public Order(
      UUID id,
      UUID cafeteriaId,
      UUID clientId,
      String clientName,
      String clientCode,
      String clientType,
      BigDecimal total,
      Instant createdAt) {
    requireInstant(createdAt);

    this.id = id;
    this.cafeteriaId = cafeteriaId;
    this.clientId = clientId;
    this.clientName = clientName;
    this.clientCode = clientCode;
    this.clientType = clientType;
    this.status = OrderStatus.PENDING;
    this.total = total;

    this.calledAt = null;
    this.reminderCount = 0;
    this.lastRemindedAt = null;
    this.deliveredAt = null;
    this.notCollectedAt = null;
    this.cancelledAt = null;

    this.createdAt = createdAt;
    this.updatedAt = createdAt;

    this.items = new ArrayList<>();
  }

  public void prepare(Instant now) {
    requireInstant(now);

    if (status == OrderStatus.CANCELLED && cancelledByClient) {
      throw new OrderConflictException(ErrorCode.ORDER_CANCELLED_BY_CLIENT);
    }
    if (status != OrderStatus.PENDING) {
      throw new InvalidOrderStateException("Solo un pedido pendiente puede pasar a preparación");
    }

    status = OrderStatus.PREPARING;
    updatedAt = now;
  }

  public void markReady(Instant now) {
    requireInstant(now);

    if (status != OrderStatus.PREPARING) {
      throw new InvalidOrderStateException(
          "Solo un pedido en preparación puede marcarse como listo");
    }

    status = OrderStatus.READY;
    updatedAt = now;
  }

  public void callStudent(Instant now) {
    requireInstant(now);

    if (status != OrderStatus.READY) {
      throw new InvalidOrderStateException("Solo un pedido listo puede llamar al estudiante");
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
      throw new InvalidOrderStateException("Solo un pedido llamado puede recibir un recordatorio");
    }

    if (reminderCount >= MAX_REMINDERS) {
      throw new ReminderLimitReachedException();
    }

    Instant referenceTime = lastRemindedAt != null ? lastRemindedAt : calledAt;

    /*
     * Un pedido CALLED siempre debe tener calledAt.
     *
     * Si esta condición falla, no estamos ante una acción
     * inválida del usuario sino ante un estado interno
     * inconsistente.
     */
    if (referenceTime == null) {
      throw new IllegalStateException(
          "Inconsistencia interna: un pedido llamado debe tener calledAt");
    }

    if (now.isBefore(referenceTime)) {
      throw new IllegalStateException(
          "Inconsistencia temporal: la fecha de la operación no puede ser anterior al último llamado o recordatorio");
    }

    Duration elapsed = Duration.between(referenceTime, now);

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
      throw new InvalidOrderStateException("Solo un pedido llamado puede marcarse como entregado");
    }

    status = OrderStatus.DELIVERED;
    deliveredAt = now;
    updatedAt = now;
  }

  public void markNotCollected(Instant now) {
    requireInstant(now);

    if (status != OrderStatus.CALLED) {
      throw new InvalidOrderStateException(
          "Solo un pedido llamado puede marcarse como no recogido");
    }

    if (reminderCount < MAX_REMINDERS) {
      throw new NotCollectedRequirementsException();
    }

    status = OrderStatus.NOT_COLLECTED;
    notCollectedAt = now;
    updatedAt = now;
  }

  /**
   * Only the client cancels, while PENDING and without a deadline (docs/decisiones.md §6).
   * Repeating it after the client already cancelled changes nothing and returns false; an order
   * ended by anyone else is still a conflict.
   */
  public boolean cancelByClient(Instant now) {
    requireInstant(now);
    if (status == OrderStatus.CANCELLED && cancelledByClient) return false;
    if (status == OrderStatus.PREPARING) {
      throw new OrderConflictException(ErrorCode.ORDER_ALREADY_PREPARING);
    }
    if (status != OrderStatus.PENDING) {
      throw new InvalidOrderStateException("Solo un pedido pendiente puede cancelarse");
    }
    status = OrderStatus.CANCELLED;
    cancelledAt = now;
    updatedAt = now;
    cancelledByClient = true;
    cancellationSource = "CLIENT";
    return true;
  }

  /**
   * The worker rejects while PENDING or PREPARING, with a reason the client will see
   * (docs/decisiones.md §6). The reason is trimmed before it is checked, so blanks are missing.
   * Repeating it after the same worker already rejected changes nothing and returns false, keeping
   * the first reason; an order ended by anyone else is still a conflict.
   */
  public boolean rejectByWorker(UUID workerId, String reason, Instant now) {
    requireInstant(now);
    if (workerId == null) throw new IllegalArgumentException("El worker es obligatorio");
    String trimmed = normalizeRejectionReason(reason);
    if (status == OrderStatus.CANCELLED
        && "WORKER".equals(cancellationSource)
        && workerId.equals(rejectedBy)) return false;
    if (status != OrderStatus.PENDING && status != OrderStatus.PREPARING) {
      throw new InvalidOrderStateException(
          "Solo un pedido pendiente o en preparación puede rechazarse");
    }
    status = OrderStatus.CANCELLED;
    cancelledAt = now;
    updatedAt = now;
    cancelledByClient = false;
    cancellationSource = "WORKER";
    rejectionReason = trimmed;
    rejectedBy = workerId;
    return true;
  }

  /** Trimmed reason of 3 to 200 characters, counted like PostgreSQL's length(). */
  public static String normalizeRejectionReason(String reason) {
    String trimmed = reason == null ? "" : reason.strip();
    int length = trimmed.codePointCount(0, trimmed.length());
    if (length < MIN_REJECTION_REASON_LENGTH) throw InvalidRejectionReasonException.required();
    if (length > MAX_REJECTION_REASON_LENGTH) throw InvalidRejectionReasonException.tooLong();
    return trimmed;
  }

  public static Order reconstitute(
      UUID id,
      UUID cafeteriaId,
      UUID clientId,
      String clientName,
      String clientCode,
      String clientType,
      OrderStatus status,
      BigDecimal total,
      Instant createdAt,
      Instant updatedAt) {
    Order order =
        new Order(id, cafeteriaId, clientId, clientName, clientCode, clientType, total, createdAt);

    order.status = status;
    order.updatedAt = updatedAt;

    return order;
  }

  public static Order reconstitute(
      UUID id,
      UUID cafeteriaId,
      UUID clientId,
      String clientName,
      String clientCode,
      String clientType,
      OrderStatus status,
      BigDecimal total,
      Instant calledAt,
      int reminderCount,
      Instant lastRemindedAt,
      Instant deliveredAt,
      Instant notCollectedAt,
      Instant cancelledAt,
      Instant createdAt,
      Instant updatedAt) {
    Order order =
        new Order(id, cafeteriaId, clientId, clientName, clientCode, clientType, total, createdAt);

    order.status = status;
    order.calledAt = calledAt;
    order.reminderCount = reminderCount;
    order.lastRemindedAt = lastRemindedAt;
    order.deliveredAt = deliveredAt;
    order.notCollectedAt = notCollectedAt;
    order.cancelledAt = cancelledAt;
    order.updatedAt = updatedAt;

    return order;
  }

  public void setItems(List<OrderItem> items) {
    this.items = items != null ? new ArrayList<>(items) : new ArrayList<>();
  }

  private static void requireInstant(Instant instant) {
    if (instant == null) {
      throw new IllegalArgumentException("La fecha de la operación es obligatoria");
    }
  }
}

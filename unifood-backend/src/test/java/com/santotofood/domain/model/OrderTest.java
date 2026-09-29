package com.santotofood.domain.model;

import com.santotofood.domain.exception.CancellationDeadlineExpiredException;
import com.santotofood.shared.error.ErrorCode;
import com.santotofood.domain.exception.InvalidOrderStateException;
import com.santotofood.domain.exception.NotCollectedRequirementsException;
import com.santotofood.domain.exception.ReminderLimitReachedException;
import com.santotofood.domain.exception.ReminderTooEarlyException;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

class OrderTest {

    private static final Instant CREATED_AT =
            Instant.parse("2026-09-27T12:00:00Z");

    private static final UUID ORDER_ID =
            UUID.fromString("11111111-1111-1111-1111-111111111111");

    private static final UUID CAFETERIA_ID =
            UUID.fromString("22222222-2222-2222-2222-222222222222");

    private static final UUID CLIENT_ID =
            UUID.fromString("33333333-3333-3333-3333-333333333333");

    private Order createPendingOrder() {
        return new Order(
                ORDER_ID,
                CAFETERIA_ID,
                CLIENT_ID,
                "Juan Pérez",
                "1234567890",
                new BigDecimal("15000.00"),
                CREATED_AT.plusSeconds(600),
                CREATED_AT
        );
    }

    private Order createCalledOrder() {
        Order order = createPendingOrder();

        order.prepare(CREATED_AT.plusSeconds(60));
        order.markReady(CREATED_AT.plusSeconds(120));
        order.callStudent(CREATED_AT.plusSeconds(180));

        return order;
    }

    @Test
    void shouldCreateOrderAsPending() {
        Order order = createPendingOrder();

        assertEquals(OrderStatus.PENDING, order.getStatus());
        assertEquals(CREATED_AT, order.getCreatedAt());
        assertEquals(CREATED_AT, order.getUpdatedAt());

        assertEquals(0, order.getReminderCount());

        assertNull(order.getCalledAt());
        assertNull(order.getLastRemindedAt());
        assertNull(order.getDeliveredAt());
        assertNull(order.getNotCollectedAt());

        assertNotNull(order.getItems());
        assertTrue(order.getItems().isEmpty());
    }

    @Test
    void shouldPreparePendingOrder() {
        Order order = createPendingOrder();

        Instant preparedAt = CREATED_AT.plusSeconds(60);

        order.prepare(preparedAt);

        assertEquals(OrderStatus.PREPARING, order.getStatus());
        assertEquals(preparedAt, order.getUpdatedAt());
    }

    @Test
    void shouldRejectPreparingOrderThatIsNotPending() {
        Order order = createPendingOrder();

        order.prepare(CREATED_AT.plusSeconds(60));

        InvalidOrderStateException exception =
                assertThrows(
                        InvalidOrderStateException.class,
                        () -> order.prepare(CREATED_AT.plusSeconds(120))
                );

        assertEquals(
                ErrorCode.INVALID_ORDER_STATE,
                exception.getCode()
        );

        assertEquals(
                "Solo un pedido pendiente puede pasar a preparación",
                exception.getMessage()
        );
    }

    @Test
    void shouldMarkPreparingOrderAsReady() {
        Order order = createPendingOrder();

        order.prepare(CREATED_AT.plusSeconds(60));

        Instant readyAt = CREATED_AT.plusSeconds(120);

        order.markReady(readyAt);

        assertEquals(OrderStatus.READY, order.getStatus());
        assertEquals(readyAt, order.getUpdatedAt());
    }

    @Test
    void shouldRejectMarkingPendingOrderAsReady() {
        Order order = createPendingOrder();

        InvalidOrderStateException exception =
                assertThrows(
                        InvalidOrderStateException.class,
                        () -> order.markReady(CREATED_AT.plusSeconds(60))
                );

        assertEquals(
                ErrorCode.INVALID_ORDER_STATE,
                exception.getCode()
        );
    }

    @Test
    void shouldCallStudentWhenOrderIsReady() {
        Order order = createPendingOrder();

        order.prepare(CREATED_AT.plusSeconds(60));
        order.markReady(CREATED_AT.plusSeconds(120));

        Instant calledAt = CREATED_AT.plusSeconds(180);

        order.callStudent(calledAt);

        assertEquals(OrderStatus.CALLED, order.getStatus());
        assertEquals(calledAt, order.getCalledAt());
        assertEquals(calledAt, order.getUpdatedAt());
        assertEquals(0, order.getReminderCount());
        assertNull(order.getLastRemindedAt());
    }

    @Test
    void shouldRejectCallingStudentWhenOrderIsNotReady() {
        Order order = createPendingOrder();

        InvalidOrderStateException exception =
                assertThrows(
                        InvalidOrderStateException.class,
                        () -> order.callStudent(CREATED_AT.plusSeconds(60))
                );

        assertEquals(
                ErrorCode.INVALID_ORDER_STATE,
                exception.getCode()
        );
    }

    @Test
    void shouldRejectFirstReminderBeforeFiveMinutes() {
        Order order = createCalledOrder();

        Instant reminderAt =
                order.getCalledAt().plusSeconds(299);

        ReminderTooEarlyException exception =
                assertThrows(
                        ReminderTooEarlyException.class,
                        () -> order.remindStudent(reminderAt)
                );

        assertEquals(
                ErrorCode.REMINDER_TOO_EARLY,
                exception.getCode()
        );

        assertEquals(
                "Debes esperar al menos 5 minutos antes de enviar otro recordatorio",
                exception.getMessage()
        );

        assertEquals(0, order.getReminderCount());
        assertNull(order.getLastRemindedAt());
    }

    @Test
    void shouldAllowFirstReminderExactlyAfterFiveMinutes() {
        Order order = createCalledOrder();

        Instant reminderAt =
                order.getCalledAt().plusSeconds(300);

        order.remindStudent(reminderAt);

        assertEquals(1, order.getReminderCount());
        assertEquals(reminderAt, order.getLastRemindedAt());
        assertEquals(reminderAt, order.getUpdatedAt());
    }

    @Test
    void shouldRejectSecondReminderBeforeFiveMinutesFromPreviousReminder() {
        Order order = createCalledOrder();

        Instant firstReminder =
                order.getCalledAt().plusSeconds(300);

        order.remindStudent(firstReminder);

        Instant secondReminder =
                firstReminder.plusSeconds(299);

        ReminderTooEarlyException exception =
                assertThrows(
                        ReminderTooEarlyException.class,
                        () -> order.remindStudent(secondReminder)
                );

        assertEquals(
                ErrorCode.REMINDER_TOO_EARLY,
                exception.getCode()
        );

        assertEquals(1, order.getReminderCount());
        assertEquals(firstReminder, order.getLastRemindedAt());
    }

    @Test
    void shouldAllowThreeRemindersSeparatedByFiveMinutes() {
        Order order = createCalledOrder();

        Instant firstReminder =
                order.getCalledAt().plusSeconds(300);

        Instant secondReminder =
                firstReminder.plusSeconds(300);

        Instant thirdReminder =
                secondReminder.plusSeconds(300);

        order.remindStudent(firstReminder);
        order.remindStudent(secondReminder);
        order.remindStudent(thirdReminder);

        assertEquals(3, order.getReminderCount());
        assertEquals(thirdReminder, order.getLastRemindedAt());
    }

    @Test
    void shouldRejectFourthReminder() {
        Order order = createCalledOrder();

        Instant firstReminder =
                order.getCalledAt().plusSeconds(300);

        Instant secondReminder =
                firstReminder.plusSeconds(300);

        Instant thirdReminder =
                secondReminder.plusSeconds(300);

        order.remindStudent(firstReminder);
        order.remindStudent(secondReminder);
        order.remindStudent(thirdReminder);

        ReminderLimitReachedException exception =
                assertThrows(
                        ReminderLimitReachedException.class,
                        () -> order.remindStudent(
                                thirdReminder.plusSeconds(300)
                        )
                );

        assertEquals(
                ErrorCode.REMINDER_LIMIT_REACHED,
                exception.getCode()
        );

        assertEquals(
                "Este pedido ya alcanzó el máximo de 3 recordatorios",
                exception.getMessage()
        );

        assertEquals(3, order.getReminderCount());
    }

    @Test
    void shouldRejectNotCollectedBeforeThreeReminders() {
        Order order = createCalledOrder();

        Instant firstReminder =
                order.getCalledAt().plusSeconds(300);

        Instant secondReminder =
                firstReminder.plusSeconds(300);

        order.remindStudent(firstReminder);
        order.remindStudent(secondReminder);

        NotCollectedRequirementsException exception =
                assertThrows(
                        NotCollectedRequirementsException.class,
                        () -> order.markNotCollected(
                                secondReminder.plusSeconds(60)
                        )
                );

        assertEquals(
                ErrorCode.NOT_COLLECTED_REQUIREMENTS_NOT_MET,
                exception.getCode()
        );

        assertEquals(
                "El pedido solo puede marcarse como no recogido después de enviar los 3 recordatorios",
                exception.getMessage()
        );

        assertEquals(OrderStatus.CALLED, order.getStatus());
        assertNull(order.getNotCollectedAt());
    }

    @Test
    void shouldMarkOrderAsNotCollectedAfterThreeReminders() {
        Order order = createCalledOrder();

        Instant firstReminder =
                order.getCalledAt().plusSeconds(300);

        Instant secondReminder =
                firstReminder.plusSeconds(300);

        Instant thirdReminder =
                secondReminder.plusSeconds(300);

        order.remindStudent(firstReminder);
        order.remindStudent(secondReminder);
        order.remindStudent(thirdReminder);

        Instant notCollectedAt =
                thirdReminder.plusSeconds(60);

        order.markNotCollected(notCollectedAt);

        assertEquals(
                OrderStatus.NOT_COLLECTED,
                order.getStatus()
        );

        assertEquals(
                notCollectedAt,
                order.getNotCollectedAt()
        );

        assertEquals(
                notCollectedAt,
                order.getUpdatedAt()
        );
    }

    @Test
    void shouldDeliverCalledOrderWithoutReminders() {
        Order order = createCalledOrder();

        Instant deliveredAt =
                order.getCalledAt().plusSeconds(60);

        order.deliver(deliveredAt);

        assertEquals(OrderStatus.DELIVERED, order.getStatus());
        assertEquals(deliveredAt, order.getDeliveredAt());
        assertEquals(deliveredAt, order.getUpdatedAt());
        assertEquals(0, order.getReminderCount());
    }

    @Test
    void shouldRejectDeliveringOrderThatWasNotCalled() {
        Order order = createPendingOrder();

        InvalidOrderStateException exception =
                assertThrows(
                        InvalidOrderStateException.class,
                        () -> order.deliver(CREATED_AT.plusSeconds(60))
                );

        assertEquals(
                ErrorCode.INVALID_ORDER_STATE,
                exception.getCode()
        );
    }

    @Test
    void shouldCancelPendingOrderBeforeDeadline() {
        Order order = createPendingOrder();

        Instant cancelledAt =
                CREATED_AT.plusSeconds(300);

        order.cancel(cancelledAt);

        assertEquals(OrderStatus.CANCELLED, order.getStatus());
        assertEquals(cancelledAt, order.getUpdatedAt());
    }

    @Test
    void shouldAllowCancellationExactlyAtDeadline() {
        Order order = createPendingOrder();

        Instant deadline =
                order.getCancellationDeadline();

        order.cancel(deadline);

        assertEquals(OrderStatus.CANCELLED, order.getStatus());
        assertEquals(deadline, order.getUpdatedAt());
    }

    @Test
    void shouldRejectCancellationAfterDeadline() {
        Order order = createPendingOrder();

        Instant afterDeadline =
                order.getCancellationDeadline().plusMillis(1);

        CancellationDeadlineExpiredException exception =
                assertThrows(
                        CancellationDeadlineExpiredException.class,
                        () -> order.cancel(afterDeadline)
                );

        assertEquals(
                ErrorCode.CANCELLATION_DEADLINE_EXPIRED,
                exception.getCode()
        );

        assertEquals(
                "El tiempo para cancelar el pedido ha expirado",
                exception.getMessage()
        );

        assertEquals(OrderStatus.PENDING, order.getStatus());
    }

    @Test
    void shouldRejectCancellationWhenOrderIsNotPending() {
        Order order = createPendingOrder();

        order.prepare(CREATED_AT.plusSeconds(60));

        InvalidOrderStateException exception =
                assertThrows(
                        InvalidOrderStateException.class,
                        () -> order.cancel(CREATED_AT.plusSeconds(120))
                );

        assertEquals(
                ErrorCode.INVALID_ORDER_STATE,
                exception.getCode()
        );
    }

    @Test
    void shouldRejectReminderWithTimeBeforeCall() {
        Order order = createCalledOrder();

        Instant invalidTime =
                order.getCalledAt().minusSeconds(1);

        IllegalStateException exception =
                assertThrows(
                        IllegalStateException.class,
                        () -> order.remindStudent(invalidTime)
                );

        assertEquals(
                "Inconsistencia temporal: la fecha de la operación no puede ser anterior al último llamado o recordatorio",
                exception.getMessage()
        );

        assertEquals(0, order.getReminderCount());
    }

    @Test
    void shouldRejectNullOperationTime() {
        Order order = createPendingOrder();

        IllegalArgumentException exception =
                assertThrows(
                        IllegalArgumentException.class,
                        () -> order.prepare(null)
                );

        assertEquals(
                "La fecha de la operación es obligatoria",
                exception.getMessage()
        );

        assertEquals(OrderStatus.PENDING, order.getStatus());
    }
}
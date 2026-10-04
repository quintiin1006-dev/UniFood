package com.santotofood.adapter.in.web.error;

import com.santotofood.application.exception.OrderNotFoundException;
import com.santotofood.application.exception.OrderProcessingSequenceException;
import com.santotofood.domain.exception.ReminderTooEarlyException;
import com.santotofood.shared.error.ErrorCode;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.web.MockHttpServletRequest;

import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

class GlobalExceptionHandlerTest {

    private GlobalExceptionHandler handler;
    private MockHttpServletRequest request;

    @BeforeEach
    void setUp() {
        handler = new GlobalExceptionHandler();

        request = new MockHttpServletRequest();
        request.setMethod("PATCH");
        request.setRequestURI(
                "/api/orders/11111111-1111-1111-1111-111111111111/remind"
        );
    }

    @Test
    void shouldReturnNotFoundWhenOrderDoesNotExist() {

        UUID orderId =
                UUID.fromString(
                        "11111111-1111-1111-1111-111111111111"
                );

        OrderNotFoundException exception =
                new OrderNotFoundException(orderId);

        ResponseEntity<ApiErrorResponse> response =
                handler.handleOrderNotFoundException(
                        exception,
                        request
                );

        assertEquals(
                HttpStatus.NOT_FOUND,
                response.getStatusCode()
        );

        assertNotNull(response.getBody());

        ApiErrorResponse body = response.getBody();

        assertEquals(404, body.status());

        assertEquals(
                ErrorCode.ORDER_NOT_FOUND.name(),
                body.code()
        );

        assertEquals(
                "No existe un pedido con id " + orderId,
                body.message()
        );

        assertEquals(
                "/api/orders/11111111-1111-1111-1111-111111111111/remind",
                body.path()
        );

        assertNotNull(body.timestamp());
    }

    @Test
    void shouldReturnConflictForDomainException() {

        ReminderTooEarlyException exception =
                new ReminderTooEarlyException();

        ResponseEntity<ApiErrorResponse> response =
                handler.handleDomainException(
                        exception,
                        request
                );

        assertEquals(
                HttpStatus.CONFLICT,
                response.getStatusCode()
        );

        assertNotNull(response.getBody());

        ApiErrorResponse body = response.getBody();

        assertEquals(409, body.status());

        assertEquals(
                ErrorCode.REMINDER_TOO_EARLY.name(),
                body.code()
        );

        assertEquals(
                "Debes esperar al menos 5 minutos antes de enviar otro recordatorio",
                body.message()
        );

        assertEquals(
                "/api/orders/11111111-1111-1111-1111-111111111111/remind",
                body.path()
        );

        assertNotNull(body.timestamp());
    }

    @Test
    void shouldReturnConflictWhenOrderProcessingSequenceIsViolated() {

        OrderProcessingSequenceException exception =
                new OrderProcessingSequenceException();

        ResponseEntity<ApiErrorResponse> response =
                handler.handleOrderProcessingSequenceException(
                        exception,
                        request
                );

        assertEquals(
                HttpStatus.CONFLICT,
                response.getStatusCode()
        );

        assertNotNull(response.getBody());

        ApiErrorResponse body = response.getBody();

        assertEquals(409, body.status());

        assertEquals(
                ErrorCode.ORDER_PROCESSING_SEQUENCE_VIOLATION.name(),
                body.code()
        );

        assertEquals(
                "No puedes preparar este pedido todavía. " +
                        "El pedido anterior debe ser procesado primero.",
                body.message()
        );

        assertEquals(
                "/api/orders/11111111-1111-1111-1111-111111111111/remind",
                body.path()
        );

        assertNotNull(body.timestamp());
    }

    @Test
    void shouldReturnInternalServerErrorForIllegalStateException() {

        IllegalStateException exception =
                new IllegalStateException(
                        "Internal state inconsistency"
                );

        ResponseEntity<ApiErrorResponse> response =
                handler.handleIllegalStateException(
                        exception,
                        request
                );

        assertEquals(
                HttpStatus.INTERNAL_SERVER_ERROR,
                response.getStatusCode()
        );

        assertNotNull(response.getBody());

        ApiErrorResponse body = response.getBody();

        assertEquals(500, body.status());
        assertEquals("INTERNAL_ERROR", body.code());

        assertEquals(
                "Ocurrió un error interno al procesar la solicitud",
                body.message()
        );

        assertEquals(
                "/api/orders/11111111-1111-1111-1111-111111111111/remind",
                body.path()
        );

        assertNotNull(body.timestamp());

        assertFalse(
                body.message().contains(
                        "Internal state inconsistency"
                )
        );
    }

    @Test
    void shouldReturnInternalServerErrorForUnexpectedException() {

        RuntimeException exception =
                new RuntimeException(
                        "Database credentials or internal details"
                );

        ResponseEntity<ApiErrorResponse> response =
                handler.handleUnexpectedException(
                        exception,
                        request
                );

        assertEquals(
                HttpStatus.INTERNAL_SERVER_ERROR,
                response.getStatusCode()
        );

        assertNotNull(response.getBody());

        ApiErrorResponse body = response.getBody();

        assertEquals(500, body.status());
        assertEquals("INTERNAL_ERROR", body.code());

        assertEquals(
                "Ocurrió un error interno al procesar la solicitud",
                body.message()
        );

        assertFalse(
                body.message().contains(
                        "Database credentials"
                )
        );

        assertNotNull(body.timestamp());
    }
}
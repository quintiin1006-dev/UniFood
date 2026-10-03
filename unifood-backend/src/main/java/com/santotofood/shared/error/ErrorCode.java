package com.santotofood.shared.error;

/**
 * Catálogo transversal de códigos de error de UniFood.
 *
 * Los códigos son independientes de HTTP y de cualquier
 * tecnología de transporte.
 *
 * Las distintas capas pueden utilizar este catálogo común,
 * mientras que las excepciones concretas permanecen en la
 * capa a la que conceptualmente pertenecen.
 */
public enum ErrorCode {

    ORDER_NOT_FOUND,

    INVALID_ORDER_STATE,

    ORDER_PROCESSING_SEQUENCE_VIOLATION,

    REMINDER_TOO_EARLY,

    REMINDER_LIMIT_REACHED,

    NOT_COLLECTED_REQUIREMENTS_NOT_MET,

    CANCELLATION_DEADLINE_EXPIRED
}
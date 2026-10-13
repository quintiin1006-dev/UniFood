package com.santotofood.shared.error;

/**
 * Catálogo transversal de códigos de error de UniFood.
 *
 * <p>Los códigos son independientes de HTTP y de cualquier tecnología de transporte.
 *
 * <p>Las distintas capas pueden utilizar este catálogo común, mientras que las excepciones
 * concretas permanecen en la capa a la que conceptualmente pertenecen.
 */
public enum ErrorCode {
  CLIENT_PROFILE_NOT_FOUND,
  CLIENT_PROFILE_TEMPORARILY_UNAVAILABLE,

  ORDER_NOT_FOUND,

  INVALID_ORDER_STATE,
  ORDER_CANCELLED_BY_CLIENT,
  ORDER_ALREADY_PREPARING,
  ORDER_CONCURRENT_MODIFICATION,

  ORDER_PROCESSING_SEQUENCE_VIOLATION,

  REMINDER_TOO_EARLY,

  REMINDER_LIMIT_REACHED,

  NOT_COLLECTED_REQUIREMENTS_NOT_MET,

  CANCELLATION_DEADLINE_EXPIRED
}

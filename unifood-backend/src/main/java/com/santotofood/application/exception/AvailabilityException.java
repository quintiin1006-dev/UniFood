package com.santotofood.application.exception;

import com.santotofood.shared.error.ErrorCode;

/** Fixed public messages; no SQL, IDs, provider or order errors enter this contract. */
public final class AvailabilityException extends RuntimeException {
  private final ErrorCode code;

  public AvailabilityException(ErrorCode code) {
    super(
        switch (code) {
          case AVAILABILITY_ITEM_NOT_FOUND -> "El producto no está disponible para esta operación.";
          case AVAILABILITY_CAFETERIA_NOT_FOUND -> "No se pudo resolver tu cafetería.";
          case AVAILABILITY_DAY_EXPIRED ->
              "El día de operación cambió. Actualiza la pantalla y vuelve a intentarlo.";
          case AVAILABILITY_CAFETERIA_INACTIVE ->
              "La cafetería está inactiva. Solo puedes cerrar o deshabilitar productos.";
          case AVAILABILITY_ITEM_INACTIVE ->
              "El producto está inactivo. Solo puedes deshabilitarlo.";
          case AVAILABILITY_CATALOG_INVALID -> "El catálogo requiere una revisión administrativa.";
          case AVAILABILITY_INVALID_REQUEST -> "La solicitud de disponibilidad no es válida.";
          default -> throw new IllegalArgumentException("Not an availability application error");
        });
    this.code = code;
  }

  public ErrorCode getCode() {
    return code;
  }
}

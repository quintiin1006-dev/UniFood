package com.santotofood.application.exception;

import com.santotofood.shared.error.ErrorCode;
import java.util.List;

/**
 * Daily menu requests that cannot be served (docs/propuesta-menu-dinamico.md, section 3.6). Every
 * message is fixed and public. {@code missingCategories} is set only for DAILY_MENU_INCOMPLETE.
 */
public class DailyMenuException extends RuntimeException {
  private final ErrorCode code;
  private final List<String> missingCategories;

  private DailyMenuException(ErrorCode code, String message, List<String> missingCategories) {
    super(message);
    this.code = code;
    this.missingCategories = missingCategories;
  }

  private static DailyMenuException of(ErrorCode code, String message) {
    return new DailyMenuException(code, message, null);
  }

  public static DailyMenuException disabled() {
    return of(ErrorCode.DAILY_MENU_DISABLED, "El menú del día no está disponible por ahora.");
  }

  public static DailyMenuException notPublished() {
    return of(ErrorCode.DAILY_MENU_NOT_PUBLISHED, "Hoy todavía no hay menú del día publicado.");
  }

  public static DailyMenuException incomplete(List<String> missingCategories) {
    return new DailyMenuException(
        ErrorCode.DAILY_MENU_INCOMPLETE,
        "Falta completar el menú antes de publicarlo.",
        List.copyOf(missingCategories));
  }

  public static DailyMenuException priceNotSet() {
    return of(
        ErrorCode.DAILY_MENU_PRICE_NOT_SET,
        "El plato del día aún no tiene precio configurado. Pídeselo al administrador.");
  }

  public static DailyMenuException versionConflict() {
    return of(
        ErrorCode.DAILY_MENU_VERSION_CONFLICT,
        "El menú cambió en otra pantalla. Actualizamos los datos; revisa y vuelve a intentarlo.");
  }

  public static DailyMenuException optionInvalid() {
    return of(
        ErrorCode.DAILY_MENU_OPTION_INVALID,
        "Cada opción debe tener entre 1 y 350 caracteres, sin comas, y hasta 20 por categoría.");
  }

  public static DailyMenuException optionDuplicated() {
    return of(ErrorCode.DAILY_MENU_OPTION_DUPLICATED, "Hay opciones repetidas en la categoría.");
  }

  public static DailyMenuException textTooLong() {
    return of(
        ErrorCode.DAILY_MENU_TEXT_TOO_LONG,
        "Las opciones de esta categoría superan los 350 caracteres en total.");
  }

  public static DailyMenuException categoryNotFound() {
    return of(ErrorCode.DAILY_MENU_CATEGORY_NOT_FOUND, "No encontramos esa categoría del menú.");
  }

  public static DailyMenuException additionUnavailable() {
    return of(ErrorCode.DAILY_MENU_ADDITION_UNAVAILABLE, "Esa adición no está disponible.");
  }

  public static DailyMenuException dateChanged() {
    return of(
        ErrorCode.DAILY_MENU_DATE_CHANGED,
        "Cambió el día. Actualiza la pantalla para ver el menú de hoy.");
  }

  public ErrorCode getCode() {
    return code;
  }

  /** Labels of the categories still missing, or null for every other code. */
  public List<String> getMissingCategories() {
    return missingCategories;
  }
}

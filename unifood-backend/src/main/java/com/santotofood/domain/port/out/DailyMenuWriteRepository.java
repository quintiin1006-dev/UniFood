package com.santotofood.domain.port.out;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Worker side of one cafeteria's daily menu (docs/propuesta-menu-dinamico.md, sections 3.1 and
 * 3.3). Every write runs with the day header locked by {@link #lockDay}, in the same transaction.
 */
public interface DailyMenuWriteRepository {

  /** Current plate of the cafeteria; empty when it was never configured. */
  Optional<Settings> findSettings(UUID cafeteriaId);

  /** The day header without locking it; empty before the first write of the day. */
  Optional<Day> findDay(UUID cafeteriaId, LocalDate businessDate);

  /** Creates the day header if missing and locks it FOR UPDATE. */
  Day lockDay(UUID cafeteriaId, LocalDate businessDate);

  /** Active catalog additions with that day's state; the price is the frozen one when on. */
  List<WorkerAddition> findWorkerAdditions(UUID cafeteriaId, LocalDate businessDate);

  /** The addition of this cafeteria, locked FOR SHARE; empty when missing or foreign. */
  Optional<CatalogAddition> lockAddition(UUID cafeteriaId, UUID additionId);

  /**
   * Leaves the category with exactly {@code labels}, in that order. An option whose label_key stays
   * keeps its id, so an edit never invalidates a client's choice of an unchanged option.
   */
  void replaceOptions(
      UUID cafeteriaId, LocalDate businessDate, UUID categoryId, List<String> labels);

  /** Copies the options of {@code from} into {@code to} for one category. */
  void copyOptions(UUID cafeteriaId, LocalDate from, LocalDate to, UUID categoryId);

  /** On: copies {@code price} only when it was not on already. Off: keeps the copied price. */
  void setAddition(
      UUID cafeteriaId, LocalDate businessDate, UUID additionId, boolean on, BigDecimal price);

  void publish(
      UUID cafeteriaId, LocalDate businessDate, String title, BigDecimal price, UUID workerId);

  void unpublish(UUID cafeteriaId, LocalDate businessDate);

  /** Increments the locked header's version and returns the new one. */
  long bumpVersion(UUID cafeteriaId, LocalDate businessDate);

  record Settings(String title, BigDecimal platePrice) {}

  record Day(long version, boolean published, String titleSnapshot, BigDecimal priceSnapshot) {}

  record WorkerAddition(UUID id, String name, BigDecimal extraPrice, boolean available) {}

  record CatalogAddition(UUID id, String name, BigDecimal extraPrice, boolean active) {}
}

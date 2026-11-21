package com.santotofood.domain.port.out;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Read-only view of one cafeteria's daily menu (docs/propuesta-menu-dinamico.md, sections 2 and
 * 3.2). Every lookup is scoped to the cafeteria and, where it applies, to one business date.
 */
public interface DailyMenuReadRepository {

  /** The day header only when it is published; title and price are the frozen snapshots. */
  Optional<PublishedDay> findPublishedDay(UUID cafeteriaId, LocalDate businessDate);

  /** Active categories of the template, ordered by position. */
  List<Category> findActiveCategories(UUID cafeteriaId);

  /** Options of that day for every SINGLE category, in insertion order within each category. */
  List<Option> findOptions(UUID cafeteriaId, LocalDate businessDate);

  /** Additions switched on that day and active in the catalog, with the day's copied price. */
  List<Addition> findAvailableAdditions(UUID cafeteriaId, LocalDate businessDate);

  record PublishedDay(String title, BigDecimal price) {}

  record Category(UUID id, String label, Kind kind, boolean canSkip) {}

  record Option(UUID id, UUID categoryId, String label) {}

  record Addition(UUID id, String name, BigDecimal extraPrice) {}

  enum Kind {
    SINGLE,
    ADDITIONS
  }
}

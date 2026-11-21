package com.santotofood.application.port.in;

import com.santotofood.application.model.WorkerDailyMenu;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * The worker's daily menu of their own cafeteria (docs/propuesta-menu-dinamico.md, section 3.1).
 * Every write carries the screen's business date and the version it saw.
 */
public interface ManageWorkerDailyMenuUseCase {
  WorkerDailyMenu getToday(UUID cafeteriaId);

  WorkerDailyMenu replaceOptions(
      UUID cafeteriaId,
      LocalDate context,
      long expectedVersion,
      UUID categoryId,
      List<String> options);

  WorkerDailyMenu setAddition(
      UUID cafeteriaId, LocalDate context, long expectedVersion, UUID additionId, boolean on);

  WorkerDailyMenu copyYesterday(UUID cafeteriaId, LocalDate context, long expectedVersion);

  WorkerDailyMenu publish(UUID cafeteriaId, UUID workerId, LocalDate context, long expectedVersion);

  WorkerDailyMenu unpublish(UUID cafeteriaId, LocalDate context, long expectedVersion);
}

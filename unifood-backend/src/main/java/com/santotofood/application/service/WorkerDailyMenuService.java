package com.santotofood.application.service;

import com.santotofood.application.exception.DailyMenuException;
import com.santotofood.application.model.WorkerDailyMenu;
import com.santotofood.application.port.in.ManageWorkerDailyMenuUseCase;
import com.santotofood.application.port.out.DailyMenuFlag;
import com.santotofood.domain.model.BusinessDate;
import com.santotofood.domain.port.out.DailyMenuReadRepository;
import com.santotofood.domain.port.out.DailyMenuReadRepository.Category;
import com.santotofood.domain.port.out.DailyMenuReadRepository.Option;
import com.santotofood.domain.port.out.DailyMenuWriteRepository;
import com.santotofood.domain.port.out.TimeProvider;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Worker writes of today's daily menu (docs/propuesta-menu-dinamico.md, sections 3.1 to 3.3). The
 * cafeteria always comes from the worker's own assignment in the database. Each business date
 * starts empty: there is no midnight job, only business_date.
 */
@Service
public class WorkerDailyMenuService implements ManageWorkerDailyMenuUseCase {
  private final DailyMenuFlag flag;
  private final DailyMenuReadRepository reads;
  private final DailyMenuWriteRepository writes;
  private final TimeProvider clock;

  public WorkerDailyMenuService(
      DailyMenuFlag flag,
      DailyMenuReadRepository reads,
      DailyMenuWriteRepository writes,
      TimeProvider clock) {
    this.flag = flag;
    this.reads = reads;
    this.writes = writes;
    this.clock = clock;
  }

  @Override
  @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ, timeout = 15)
  public WorkerDailyMenu getToday(UUID cafeteriaId) {
    enabled();
    return state(cafeteriaId, today());
  }

  @Override
  @Transactional(timeout = 15)
  public WorkerDailyMenu replaceOptions(
      UUID cafeteriaId,
      LocalDate context,
      long expectedVersion,
      UUID categoryId,
      List<String> options) {
    var date = begin(cafeteriaId, context, expectedVersion);
    single(cafeteriaId, categoryId);
    writes.replaceOptions(cafeteriaId, date, categoryId, DailyMenuRules.normalizeOptions(options));
    return finish(cafeteriaId, context, date);
  }

  @Override
  @Transactional(timeout = 15)
  public WorkerDailyMenu setAddition(
      UUID cafeteriaId, LocalDate context, long expectedVersion, UUID additionId, boolean on) {
    var date = begin(cafeteriaId, context, expectedVersion);
    var addition =
        writes
            .lockAddition(cafeteriaId, additionId)
            .orElseThrow(DailyMenuException::additionUnavailable);
    // Switching off is always allowed; switching on needs an active catalog addition.
    if (on && !addition.active()) throw DailyMenuException.additionUnavailable();
    writes.setAddition(cafeteriaId, date, additionId, on, addition.extraPrice());
    return finish(cafeteriaId, context, date);
  }

  @Override
  @Transactional(timeout = 15)
  public WorkerDailyMenu copyYesterday(UUID cafeteriaId, LocalDate context, long expectedVersion) {
    var date = begin(cafeteriaId, context, expectedVersion);
    Set<UUID> filled =
        reads.findOptions(cafeteriaId, date).stream()
            .map(Option::categoryId)
            .collect(Collectors.toSet());
    var skipped = new ArrayList<String>();
    // Ingredients only, into categories still empty today; additions are never copied.
    for (Category category : DailyMenuRules.singles(reads.findActiveCategories(cafeteriaId))) {
      if (filled.contains(category.id())) skipped.add(category.label());
      else writes.copyOptions(cafeteriaId, date.minusDays(1), date, category.id());
    }
    return finish(cafeteriaId, context, date).withSkipped(skipped);
  }

  @Override
  @Transactional(timeout = 15)
  public WorkerDailyMenu publish(
      UUID cafeteriaId, UUID workerId, LocalDate context, long expectedVersion) {
    var date = begin(cafeteriaId, context, expectedVersion);
    var settings =
        writes
            .findSettings(cafeteriaId)
            .filter(plate -> plate.platePrice() != null)
            .orElseThrow(DailyMenuException::priceNotSet);
    var categories = reads.findActiveCategories(cafeteriaId);
    var options = reads.findOptions(cafeteriaId, date);
    if (!DailyMenuRules.complete(categories, options))
      throw DailyMenuException.incomplete(DailyMenuRules.missing(categories, options));
    // Publishing (again) freezes the current title and price for this day.
    writes.publish(cafeteriaId, date, settings.title(), settings.platePrice(), workerId);
    return finish(cafeteriaId, context, date);
  }

  @Override
  @Transactional(timeout = 15)
  public WorkerDailyMenu unpublish(UUID cafeteriaId, LocalDate context, long expectedVersion) {
    var date = begin(cafeteriaId, context, expectedVersion);
    // Hidden for new orders only; orders already placed keep their own copy.
    writes.unpublish(cafeteriaId, date);
    return finish(cafeteriaId, context, date);
  }

  /** Flag, screen date, header lock and version, in this order. */
  private LocalDate begin(UUID cafeteriaId, LocalDate context, long expectedVersion) {
    enabled();
    var date = checkDate(context);
    var day = writes.lockDay(cafeteriaId, date);
    if (day.version() != expectedVersion) throw DailyMenuException.versionConflict();
    return date;
  }

  private WorkerDailyMenu finish(UUID cafeteriaId, LocalDate context, LocalDate date) {
    writes.bumpVersion(cafeteriaId, date);
    // A wait on the lock may span midnight: reject and roll back that write.
    checkDate(context);
    return state(cafeteriaId, date);
  }

  private void single(UUID cafeteriaId, UUID categoryId) {
    DailyMenuRules.singles(reads.findActiveCategories(cafeteriaId)).stream()
        .filter(category -> category.id().equals(categoryId))
        .findFirst()
        .orElseThrow(DailyMenuException::categoryNotFound);
  }

  private WorkerDailyMenu state(UUID cafeteriaId, LocalDate date) {
    var day = writes.findDay(cafeteriaId, date);
    var settings = writes.findSettings(cafeteriaId);
    var categories = reads.findActiveCategories(cafeteriaId);
    var options = reads.findOptions(cafeteriaId, date);
    boolean published = day.map(DailyMenuWriteRepository.Day::published).orElse(false);
    var title =
        published
            ? day.get().titleSnapshot()
            : settings.map(DailyMenuWriteRepository.Settings::title).orElse(null);
    var price =
        published
            ? day.get().priceSnapshot()
            : settings.map(DailyMenuWriteRepository.Settings::platePrice).orElse(null);
    var views =
        DailyMenuRules.singles(categories).stream()
            .map(
                category -> {
                  var own =
                      options.stream()
                          .filter(option -> option.categoryId().equals(category.id()))
                          .map(option -> new WorkerDailyMenu.Option(option.id(), option.label()))
                          .toList();
                  int used = own.stream().mapToInt(o -> DailyMenuRules.length(o.label())).sum();
                  return new WorkerDailyMenu.Category(
                      category.id(), category.label(), category.canSkip(), own, used);
                })
            .toList();
    var additions =
        writes.findWorkerAdditions(cafeteriaId, date).stream()
            .map(
                addition ->
                    new WorkerDailyMenu.Addition(
                        addition.id(),
                        addition.name(),
                        addition.extraPrice(),
                        addition.available()))
            .toList();
    return new WorkerDailyMenu(
        date,
        day.map(DailyMenuWriteRepository.Day::version).orElse(0L),
        published,
        DailyMenuRules.complete(categories, options),
        DailyMenuRules.missing(categories, options),
        settings.map(plate -> plate.platePrice() != null).orElse(false),
        title,
        price,
        views,
        additions,
        null);
  }

  private void enabled() {
    if (!flag.enabled()) throw DailyMenuException.disabled();
  }

  private LocalDate today() {
    return BusinessDate.from(clock.now()).value();
  }

  private LocalDate checkDate(LocalDate context) {
    var date = today();
    if (!date.equals(context)) throw DailyMenuException.dateChanged();
    return date;
  }
}

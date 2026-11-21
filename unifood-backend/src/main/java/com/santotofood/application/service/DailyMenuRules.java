package com.santotofood.application.service;

import com.santotofood.domain.port.out.DailyMenuReadRepository;
import com.santotofood.domain.port.out.DailyMenuReadRepository.Category;
import com.santotofood.domain.port.out.DailyMenuReadRepository.Kind;
import com.santotofood.domain.port.out.DailyMenuReadRepository.Option;
import com.santotofood.domain.port.out.DailyMenuReadRepository.PublishedDay;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Shared reading rule: a day is served only when published and complete, that is, every active
 * SINGLE category that cannot be skipped has an option that day (section 2.2). Completeness is
 * computed on read, never stored.
 */
final class DailyMenuRules {
  private DailyMenuRules() {}

  record ServableDay(PublishedDay day, List<Category> categories, List<Option> options) {}

  static Optional<ServableDay> servable(
      DailyMenuReadRepository menus, UUID cafeteriaId, LocalDate businessDate) {
    var day = menus.findPublishedDay(cafeteriaId, businessDate);
    if (day.isEmpty()) return Optional.empty();
    var categories = menus.findActiveCategories(cafeteriaId);
    var options = menus.findOptions(cafeteriaId, businessDate);
    if (!complete(categories, options)) return Optional.empty();
    return Optional.of(new ServableDay(day.get(), categories, options));
  }

  static boolean complete(List<Category> categories, List<Option> options) {
    Set<UUID> filled = options.stream().map(Option::categoryId).collect(Collectors.toSet());
    return categories.stream()
        .filter(category -> category.kind() == Kind.SINGLE && !category.canSkip())
        .allMatch(category -> filled.contains(category.id()));
  }
}

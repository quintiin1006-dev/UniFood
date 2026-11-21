package com.santotofood.application.service;

import com.santotofood.application.exception.DailyMenuException;
import com.santotofood.domain.port.out.DailyMenuReadRepository;
import com.santotofood.domain.port.out.DailyMenuReadRepository.Category;
import com.santotofood.domain.port.out.DailyMenuReadRepository.Kind;
import com.santotofood.domain.port.out.DailyMenuReadRepository.Option;
import com.santotofood.domain.port.out.DailyMenuReadRepository.PublishedDay;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * Shared daily menu rules (docs/propuesta-menu-dinamico.md, section 2.2): completeness, computed on
 * read and never stored, and the worker's option texts.
 */
final class DailyMenuRules {
  /** Per option and per category (sum of its options); 031 enforces the same 350 in a trigger. */
  static final int TEXT_LIMIT = 350;

  static final int MAX_OPTIONS = 20;
  private static final Pattern SPACES = Pattern.compile("\\s+");

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

  /**
   * Complete: at least one active SINGLE category has options today, and every active SINGLE
   * category that cannot be skipped has one. A day with no active category is never complete.
   * Shared by the reads, by publishing and, from PR 4, by the order validation.
   */
  static boolean complete(List<Category> categories, List<Option> options) {
    Set<UUID> filled = filled(options);
    var singles = singles(categories);
    return singles.stream().anyMatch(category -> filled.contains(category.id()))
        && singles.stream()
            .filter(category -> !category.canSkip())
            .allMatch(category -> filled.contains(category.id()));
  }

  /**
   * Labels the worker still has to fill, in template order: the mandatory SINGLE categories without
   * options, or, when there is none of those, every SINGLE category if all of them are empty.
   */
  static List<String> missing(List<Category> categories, List<Option> options) {
    Set<UUID> filled = filled(options);
    var singles = singles(categories);
    var mandatory =
        singles.stream()
            .filter(category -> !category.canSkip() && !filled.contains(category.id()))
            .map(Category::label)
            .toList();
    if (!mandatory.isEmpty()) return mandatory;
    if (singles.stream().anyMatch(category -> filled.contains(category.id()))) return List.of();
    return singles.stream().map(Category::label).toList();
  }

  /**
   * Trims each text and collapses its inner spaces; then each one must have 1 to 350 characters and
   * no comma, there are at most 20, none repeats ignoring case and they add up to 350.
   */
  static List<String> normalizeOptions(List<String> raw) {
    if (raw.size() > MAX_OPTIONS) throw DailyMenuException.optionInvalid();
    var labels = new ArrayList<String>(raw.size());
    var keys = new HashSet<String>();
    int used = 0;
    for (String text : raw) {
      if (text == null) throw DailyMenuException.optionInvalid();
      String label = SPACES.matcher(text.strip()).replaceAll(" ");
      int length = length(label);
      if (length < 1 || length > TEXT_LIMIT || label.indexOf(',') >= 0)
        throw DailyMenuException.optionInvalid();
      // Same key as 031's label_key: lower(btrim(label)).
      if (!keys.add(label.toLowerCase(Locale.ROOT))) throw DailyMenuException.optionDuplicated();
      used += length;
      labels.add(label);
    }
    if (used > TEXT_LIMIT) throw DailyMenuException.textTooLong();
    return List.copyOf(labels);
  }

  /** Characters as PostgreSQL's length() counts them (code points, not UTF-16 units). */
  static int length(String text) {
    return text.codePointCount(0, text.length());
  }

  static List<Category> singles(List<Category> categories) {
    return categories.stream().filter(category -> category.kind() == Kind.SINGLE).toList();
  }

  private static Set<UUID> filled(List<Option> options) {
    return options.stream().map(Option::categoryId).collect(Collectors.toSet());
  }
}

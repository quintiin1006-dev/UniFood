package com.santotofood.application.service;

import static org.junit.jupiter.api.Assertions.*;

import com.santotofood.application.exception.DailyMenuException;
import com.santotofood.domain.port.out.DailyMenuReadRepository.Category;
import com.santotofood.domain.port.out.DailyMenuReadRepository.Kind;
import com.santotofood.domain.port.out.DailyMenuReadRepository.Option;
import com.santotofood.shared.error.ErrorCode;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

class DailyMenuRulesTest {
  static final Category PROTEIN = new Category(UUID.randomUUID(), "Proteína", Kind.SINGLE, false);
  static final Category STARCH = new Category(UUID.randomUUID(), "Principio", Kind.SINGLE, false);
  static final Category DRINK = new Category(UUID.randomUUID(), "Bebida", Kind.SINGLE, true);
  static final Category EXTRAS = new Category(UUID.randomUUID(), "Adiciones", Kind.ADDITIONS, true);
  static final List<Category> TEMPLATE = List.of(PROTEIN, STARCH, DRINK, EXTRAS);

  static Option option(Category category) {
    return new Option(UUID.randomUUID(), category.id(), "x");
  }

  static ErrorCode code(List<String> raw) {
    return assertThrows(DailyMenuException.class, () -> DailyMenuRules.normalizeOptions(raw))
        .getCode();
  }

  @Test
  void trimsAndCollapsesSpacesKeepingOrderAndCase() {
    assertEquals(
        List.of("Pollo a la plancha", "Res"),
        DailyMenuRules.normalizeOptions(List.of("  Pollo   a\tla  plancha ", "Res")));
    assertEquals(List.of(), DailyMenuRules.normalizeOptions(List.of()));
  }

  @ParameterizedTest
  @ValueSource(strings = {"", "   ", "Arroz, frijol", ","})
  void emptyOrCommaTextsAreInvalid(String text) {
    assertEquals(ErrorCode.DAILY_MENU_OPTION_INVALID, code(List.of(text)));
  }

  @Test
  void nullTextIsInvalid() {
    assertEquals(ErrorCode.DAILY_MENU_OPTION_INVALID, code(Arrays.asList("Arroz", null)));
  }

  @Test
  void duplicatesIgnoreCaseAndSpaces() {
    assertEquals(
        ErrorCode.DAILY_MENU_OPTION_DUPLICATED, code(List.of("Arroz blanco", " arroz  BLANCO")));
  }

  @Test
  void oneOptionOf350IsTheLimitAnd351IsInvalid() {
    assertEquals(1, DailyMenuRules.normalizeOptions(List.of("a".repeat(350))).size());
    assertEquals(ErrorCode.DAILY_MENU_OPTION_INVALID, code(List.of("a".repeat(351))));
  }

  @Test
  void categoryTotalOf350IsTheLimitAnd351IsTooLong() {
    assertEquals(
        2, DailyMenuRules.normalizeOptions(List.of("a".repeat(175), "b".repeat(175))).size());
    assertEquals(
        ErrorCode.DAILY_MENU_TEXT_TOO_LONG, code(List.of("a".repeat(175), "b".repeat(176))));
  }

  @Test
  void charactersAreCountedLikePostgres() {
    // «ñ» and an emoji count as one character each, as length() does in PostgreSQL.
    assertEquals(1, DailyMenuRules.length("ñ"));
    assertEquals(1, DailyMenuRules.length("🍗"));
    assertEquals(1, DailyMenuRules.normalizeOptions(List.of("🍗".repeat(350))).size());
  }

  @Test
  void twentyOptionsIsTheLimitAndTwentyOneIsInvalid() {
    var twenty = new ArrayList<String>();
    for (int i = 0; i < 20; i++) twenty.add("Opción " + i);
    assertEquals(20, DailyMenuRules.normalizeOptions(twenty).size());
    twenty.add("Otra");
    assertEquals(ErrorCode.DAILY_MENU_OPTION_INVALID, code(twenty));
  }

  @Test
  void completeNeedsEveryMandatoryCategoryAndOneWithOptions() {
    assertTrue(DailyMenuRules.complete(TEMPLATE, List.of(option(PROTEIN), option(STARCH))));
    assertFalse(DailyMenuRules.complete(TEMPLATE, List.of(option(PROTEIN))));
    assertEquals(List.of("Principio"), DailyMenuRules.missing(TEMPLATE, List.of(option(PROTEIN))));
    assertEquals(List.of("Proteína", "Principio"), DailyMenuRules.missing(TEMPLATE, List.of()));
    assertEquals(
        List.of(), DailyMenuRules.missing(TEMPLATE, List.of(option(PROTEIN), option(STARCH))));
  }

  @Test
  void withoutMandatoryCategoriesSomeOptionIsStillNeeded() {
    var optional = List.of(DRINK, EXTRAS);
    assertFalse(DailyMenuRules.complete(optional, List.of()));
    assertEquals(List.of("Bebida"), DailyMenuRules.missing(optional, List.of()));
    assertTrue(DailyMenuRules.complete(optional, List.of(option(DRINK))));
    assertFalse(DailyMenuRules.complete(Collections.emptyList(), List.of()));
  }
}

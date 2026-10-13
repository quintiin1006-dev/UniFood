package com.santotofood.domain.model;

import static org.junit.jupiter.api.Assertions.*;

import java.math.BigDecimal;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;

class LunchTest {
  @Test
  void legacyConstructorKeepsClassificationPendingWithoutChangingAvailability() {
    Lunch lunch =
        new Lunch(UUID.randomUUID(), UUID.randomUUID(), "Legacy", null, BigDecimal.TEN, null, 2);
    assertNull(lunch.getCategory());
    assertTrue(lunch.isAvailable());
    lunch.decreaseStock(2);
    assertFalse(lunch.isAvailable());
    assertNull(lunch.getCategory());
    lunch.increaseStock(1);
    lunch.deactivate();
    assertFalse(lunch.isAvailable());
    lunch.activate();
    assertTrue(lunch.isAvailable());
  }

  @ParameterizedTest
  @EnumSource(CatalogCategory.class)
  void classificationDoesNotReplaceActivityOrStock(CatalogCategory category) {
    Lunch lunch =
        new Lunch(
            UUID.randomUUID(),
            UUID.randomUUID(),
            "Classified",
            null,
            BigDecimal.TEN,
            null,
            0,
            category);
    assertEquals(category, lunch.getCategory());
    assertFalse(lunch.isAvailable());
    lunch.increaseStock(1);
    assertTrue(lunch.isAvailable());
    lunch.deactivate();
    assertFalse(lunch.isAvailable());
    assertEquals(category, lunch.getCategory());
  }

  @Test
  void reconstitutionPreservesInactiveUnclassifiedProducts() {
    Lunch lunch =
        Lunch.reconstitute(
            UUID.randomUUID(),
            UUID.randomUUID(),
            "Inactive",
            null,
            BigDecimal.TEN,
            null,
            9,
            false,
            null);
    assertFalse(lunch.isActive());
    assertFalse(lunch.isAvailable());
    assertNull(lunch.getCategory());
  }
}

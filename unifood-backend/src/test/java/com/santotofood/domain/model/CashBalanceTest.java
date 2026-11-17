package com.santotofood.domain.model;

import static org.junit.jupiter.api.Assertions.*;

import java.util.Map;
import org.junit.jupiter.api.Test;

class CashBalanceTest {
  @Test
  void withoutSalesTheExpectedCashIsTheFloat() {
    var balance = new CashBalance(50_000, 0, 0, 0);
    assertEquals(50_000, balance.expected());
    assertEquals(0, balance.difference(50_000));
    assertEquals(CashBalance.Outcome.BALANCED, CashBalance.outcome(0));
  }

  @Test
  void expectedAddsSalesAndIncomeAndSubtractsExpenses() {
    var balance = new CashBalance(50_000, 132_000, 5_000, 20_000);
    assertEquals(167_000, balance.expected());
  }

  @Test
  void positiveDifferenceIsSurplusAndNegativeIsShortage() {
    var balance = new CashBalance(10_000, 30_000, 0, 0);
    assertEquals(500, balance.difference(40_500));
    assertEquals(CashBalance.Outcome.SURPLUS, CashBalance.outcome(500));
    assertEquals(-2_050, balance.difference(37_950));
    assertEquals(CashBalance.Outcome.SHORTAGE, CashBalance.outcome(-2_050));
  }

  @Test
  void toleranceIsInclusiveOnBothSides() {
    assertTrue(CashBalance.withinTolerance(2_000, 2_000));
    assertTrue(CashBalance.withinTolerance(-2_000, 2_000));
    assertFalse(CashBalance.withinTolerance(2_050, 2_000));
    assertFalse(CashBalance.withinTolerance(-2_050, 2_000));
    assertTrue(CashBalance.withinTolerance(0, 0));
    assertFalse(CashBalance.withinTolerance(50, 0));
  }

  @Test
  void anExpenseNeverTakesTheDrawerBelowZero() {
    var balance = new CashBalance(10_000, 5_000, 0, 0);
    assertTrue(balance.allowsExpense(15_000));
    assertFalse(balance.allowsExpense(15_050));
    assertFalse(balance.allowsExpense(0));
  }

  @Test
  void negativeAmountsAndOverflowAreRejected() {
    assertThrows(IllegalArgumentException.class, () -> new CashBalance(-1, 0, 0, 0));
    assertThrows(IllegalArgumentException.class, () -> new CashBalance(0, 0, 0, 0).difference(-1));
    assertThrows(
        ArithmeticException.class, () -> new CashBalance(Long.MAX_VALUE, 1, 0, 0).expected());
  }

  @Test
  void countTotalsEveryDenominationExactly() {
    var count =
        CashCount.of(
            Map.of(
                50000, 2, 20000, 1, 10000, 3, 5000, 1, 2000, 4, 1000, 2, 500, 3, 200, 5, 100, 7, 50,
                1));
    assertEquals(
        100_000 + 20_000 + 30_000 + 5_000 + 8_000 + 2_000 + 1_500 + 1_000 + 700 + 50,
        count.total());
    assertEquals(CashCount.DENOMINATIONS, count.quantities().keySet().stream().toList());
  }

  @Test
  void missingDenominationsCountAsZero() {
    var count = CashCount.of(Map.of(1000, 3));
    assertEquals(3_000, count.total());
    assertEquals(0, count.quantities().get(50000));
    assertEquals(0, CashCount.of(Map.of()).total());
  }

  @Test
  void unknownDenominationsAndOutOfRangeQuantitiesAreRejected() {
    assertThrows(IllegalArgumentException.class, () -> CashCount.of(Map.of(3000, 1)));
    assertThrows(IllegalArgumentException.class, () -> CashCount.of(Map.of(100000, 1)));
    assertThrows(IllegalArgumentException.class, () -> CashCount.of(Map.of(1000, -1)));
    assertThrows(IllegalArgumentException.class, () -> CashCount.of(Map.of(1000, 10_001)));
  }
}

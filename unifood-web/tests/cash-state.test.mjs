import { test } from "node:test";
import assert from "node:assert/strict";
import { availabilityLoader } from "./helpers/load-availability.mjs";

// Pure logic of the «Caja» tab: the count wizard, its validations and the presentation.
const load = availabilityLoader();
const state = load("features/cash/state.ts");
const contracts = load("features/cash/contracts.ts");
const presentation = load("features/cash/presentation.ts");

test("the count adds every denomination in whole pesos", () => {
  const draft = state.emptyCount();
  assert.equal(state.countTotal(draft), 0);
  Object.assign(draft, {
    50000: "2",
    20000: "1",
    2000: "3",
    1000: "4",
    500: "1",
    50: "3",
  });
  assert.equal(
    state.countTotal(draft),
    100000 + 20000 + 6000 + 4000 + 500 + 150,
  );
  assert.equal(state.lineSubtotal(draft, 2000), 6000);
  assert.deepEqual(
    state.countLines(draft).map((line) => line.denomination),
    [50000, 20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50],
  );
});

test("quantities keep digits only and are capped at 10.000", () => {
  assert.equal(state.sanitizeQuantity("12"), "12");
  assert.equal(state.sanitizeQuantity("-3"), "3");
  assert.equal(state.sanitizeQuantity("1.000"), "1000");
  assert.equal(state.sanitizeQuantity("0007"), "7");
  assert.equal(state.sanitizeQuantity("99999999"), "10000");
  assert.equal(state.sanitizeQuantity("abc"), "");
});

test("peso amounts must be whole and within the limit", () => {
  assert.equal(state.parsePesos("20000"), 20000);
  assert.equal(state.parsePesos("20.000"), 20000);
  assert.equal(state.parsePesos("$ 1.500"), 1500);
  assert.equal(state.parsePesos("1500,5"), null);
  assert.equal(state.parsePesos(""), null);
  assert.equal(state.parsePesos("200000000"), null);
});

test("the wizard skips the note when it balances and requires it otherwise", () => {
  assert.equal(state.nextStep("count", 0), "compare");
  assert.equal(state.nextStep("compare", 0), "confirm");
  assert.equal(state.previousStep("confirm", 0), "compare");
  assert.equal(state.nextStep("compare", -2050), "note");
  assert.equal(state.nextStep("note", -2050), "confirm");
  assert.equal(state.previousStep("confirm", 500), "note");
  assert.equal(state.previousStep("note", 500), "compare");
  assert.match(state.noteError("", -50), /al menos 10/);
  assert.match(state.noteError("corta", 500), /al menos 10/);
  assert.equal(state.noteError("Faltan 50 de un vuelto", -50), null);
  assert.equal(state.noteError("", 0), null);
  assert.match(state.noteError("x".repeat(501), 0), /hasta 500/);
  // Code points, as PostgreSQL counts them: ten emoji are ten characters.
  assert.equal(state.noteError("😀".repeat(10), 1), null);
});

test("the BFF rejects commands outside the contract before calling Spring", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  assert.deepEqual(
    contracts.parseOpenCommand({ shift: "LUNCH", openingFloat: 50000 }),
    {
      shift: "LUNCH",
      openingFloat: 50000,
    },
  );
  for (const bad of [
    { shift: "LUNCH", openingFloat: 50000.5 },
    { shift: "LUNCH", openingFloat: "50000" },
    { shift: "DINNER", openingFloat: 0 },
    { shift: "LUNCH", openingFloat: -1 },
    { shift: "LUNCH", openingFloat: 0, cafeteriaId: id },
  ])
    assert.equal(contracts.parseOpenCommand(bad), null, JSON.stringify(bad));
  assert.deepEqual(
    contracts.parseMovementCommand({
      requestId: id,
      kind: "EXPENSE",
      amount: 4000,
      reason: "  Consignación  ",
    }),
    { requestId: id, kind: "EXPENSE", amount: 4000, reason: "Consignación" },
  );
  assert.equal(
    contracts.parseMovementCommand({
      requestId: id,
      kind: "EXPENSE",
      amount: 0,
      reason: "Hielo",
    }),
    null,
  );
  assert.equal(
    contracts.parseMovementCommand({
      requestId: id,
      kind: "EXPENSE",
      amount: 10,
      reason: "  x ",
    }),
    null,
  );
  const lines = [{ denomination: 50000, quantity: 1 }];
  assert.ok(
    contracts.parseCloseCommand({
      lines,
      note: null,
      expectedCash: 50000,
      expectedVersion: 0,
    }),
  );
  for (const bad of [
    {
      lines: [{ denomination: 3000, quantity: 1 }],
      note: null,
      expectedCash: 0,
      expectedVersion: 0,
    },
    {
      lines: [...lines, ...lines],
      note: null,
      expectedCash: 0,
      expectedVersion: 0,
    },
    {
      lines: [{ denomination: 50, quantity: 10001 }],
      note: null,
      expectedCash: 0,
      expectedVersion: 0,
    },
    { lines, note: "x".repeat(501), expectedCash: 0, expectedVersion: 0 },
    { lines, note: null, expectedCash: 0, expectedVersion: -1 },
    { lines, note: null, expectedCash: 0, expectedVersion: 0, force: "yes" },
  ])
    assert.equal(
      contracts.parseCloseCommand(bad),
      null,
      JSON.stringify(bad).slice(0, 80),
    );
  assert.equal(
    contracts.parseReopenCommand({ reason: "corto", expectedVersion: 1 }),
    null,
  );
  assert.ok(
    contracts.parseReopenCommand({
      reason: "Faltó registrar un retiro",
      expectedVersion: 1,
    }),
  );
});

test("amounts are shown as whole pesos with an explicit sign for differences", () => {
  const text = (value) => value.replace(/\s/g, " ");
  assert.equal(text(presentation.formatPesos(22500)), "$22.500");
  assert.equal(text(presentation.formatPesos(-2050)), "-$2.050");
  assert.equal(text(presentation.formatDifference(500)), "+$500");
  assert.equal(text(presentation.formatDifference(0)), "$0");
  assert.equal(presentation.formatSequence(7), "0007");
  assert.equal(
    presentation.suggestedShift(new Date("2026-11-20T15:59:00Z")),
    "BREAKFAST",
  );
  assert.equal(
    presentation.suggestedShift(new Date("2026-11-20T16:00:00Z")),
    "LUNCH",
  );
  // A business date never moves with the browser's zone.
  assert.match(
    presentation.formatCashDate("2026-11-20"),
    /20 de noviembre de 2026/,
  );
});

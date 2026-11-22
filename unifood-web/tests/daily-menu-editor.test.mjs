import { test } from "node:test";
import assert from "node:assert/strict";
import { availabilityLoader } from "./helpers/load-availability.mjs";

// PR 7 (docs/propuesta-menu-dinamico.md 4.3 and 5): the worker editor's pure logic and queue.

const load = availabilityLoader();
const editor = load("features/daily-menu/editor.ts");
const messages = load("features/shared/messages.ts");

const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const day = (overrides = {}) => ({
  businessDate: "2026-11-22",
  version: 1,
  published: false,
  complete: false,
  missingCategories: [],
  priceSet: true,
  title: "Almuerzo del día",
  price: "9500.00",
  categories: [
    {
      id: id(1),
      label: "Proteína",
      kind: "SINGLE",
      canSkip: false,
      options: [],
      textUsed: 0,
    },
    {
      id: id(2),
      label: "Bebida",
      kind: "SINGLE",
      canSkip: true,
      options: [],
      textUsed: 0,
    },
  ],
  additions: [
    { id: id(9), name: "Huevo", extraPrice: "2000.00", available: false },
  ],
  ...overrides,
});

test("normalization: ends trimmed and inner spaces collapsed", () => {
  assert.equal(
    editor.normalizeOption("  Arroz   con  pollo "),
    "Arroz con pollo",
  );
  const result = editor.commitDraft([], "  Arroz  ", true);
  assert.deepEqual(result, { options: ["Arroz"], rest: "", error: null });
  assert.deepEqual(editor.commitDraft([], "   ", true).options, []);
});

test("a comma creates chips and keeps the last part in the field", () => {
  assert.deepEqual(
    editor.commitDraft(["Arroz"], "Lentejas, Frijol,Pa", false),
    {
      options: ["Arroz", "Lentejas", "Frijol"],
      rest: "Pa",
      error: null,
    },
  );
  assert.deepEqual(editor.commitDraft([], ",,", false).options, []);
});

test("duplicates, without case, create nothing and keep the text", () => {
  assert.deepEqual(editor.commitDraft(["Arroz"], " ARROZ ", true), {
    options: ["Arroz"],
    rest: " ARROZ ",
    error: "duplicate",
  });
  // Within the same paste: the second one stops.
  const pasted = editor.commitDraft([], "Sopa, sopa, Jugo", true);
  assert.deepEqual(pasted.options, ["Sopa"]);
  assert.equal(pasted.error, "duplicate");
});

test("at most 20 options", () => {
  const nineteen = Array.from({ length: 19 }, (_, n) => `O${n}`);
  assert.equal(editor.commitDraft(nineteen, "Más", true).options.length, 20);
  const full = editor.commitDraft([...nineteen, "O19"], "Otra", true);
  assert.equal(full.error, "max");
  assert.equal(full.options.length, 20);
  assert.equal(full.rest, "Otra");
});

test("350 characters per category count the pending text too", () => {
  const a = "a".repeat(200);
  assert.equal(editor.textUsed([a], "  bb  "), 202);
  assert.equal(editor.overLimit([a], "b".repeat(150)), false);
  assert.equal(editor.overLimit([a], "b".repeat(151)), true);
  // Exactly 350 is allowed; 351 creates nothing.
  assert.equal(editor.commitDraft([a], "b".repeat(150), true).error, null);
  const over = editor.commitDraft([a], "b".repeat(151), true);
  assert.equal(over.error, "tooLong");
  assert.deepEqual(over.options, [a]);
  // A chip that fits, while the rest still typed would overflow, is not created.
  assert.equal(
    editor.commitDraft([a], `${"b".repeat(100)},${"c".repeat(60)}`, false)
      .error,
    "tooLong",
  );
});

test("«Publicar menú» reasons: price first, then the red boxes, then missing options", () => {
  const empty = day();
  assert.deepEqual(
    editor.publishCheck(day({ priceSet: false }), empty.categories, false),
    {
      reasons: [messages.DAILY_MENU_NO_PRICE],
      disabled: true,
    },
  );
  assert.deepEqual(editor.publishCheck(empty, empty.categories, true), {
    reasons: [messages.DAILY_MENU_FIX_LENGTH],
    disabled: true,
  });
  assert.deepEqual(editor.publishCheck(empty, empty.categories, false), {
    reasons: ["Falta una opción en Proteína"],
    disabled: false,
  });
  const filled = empty.categories.map((category, index) =>
    index === 0
      ? { ...category, options: [{ id: id(5), label: "Pollo" }] }
      : category,
  );
  assert.deepEqual(editor.publishCheck(empty, filled, false), {
    reasons: [],
    disabled: false,
  });
});

/** A fake API: every write is held until the test resolves it. */
function fakeApi(initial = day()) {
  const calls = [];
  const state = { day: initial };
  const pending = [];
  const respond = (kind, args) =>
    new Promise((resolve, reject) => {
      calls.push({ kind, args });
      pending.push({ resolve, reject, kind, args });
    });
  return {
    calls,
    pending,
    state,
    api: {
      today: async () => {
        calls.push({ kind: "today" });
        if (state.todayError) throw state.todayError;
        return state.day;
      },
      options: (...args) => respond("options", args),
      addition: (...args) => respond("addition", args),
      action: (...args) => respond("action", args),
    },
  };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));
const noTimers = { set: () => 1, clear: () => {} };

test("writes are queued so each sends the version the previous one left", async () => {
  const fake = fakeApi();
  const store = new editor.DailyMenuEditorStore(fake.api, noTimers);
  await store.refresh();
  const first = store.setOptions(id(1), ["Pollo"]);
  const second = store.setOptions(id(2), ["Limonada"]);
  await tick();
  // Optimistic: both shown at once; only one request in flight.
  assert.deepEqual(
    store.getSnapshot().categories.map((c) => c.options.map((o) => o.label)),
    [["Pollo"], ["Limonada"]],
  );
  assert.equal(fake.pending.length, 1);
  assert.deepEqual(fake.pending[0].args, ["2026-11-22", 1, id(1), ["Pollo"]]);
  const afterFirst = day({ version: 2 });
  afterFirst.categories[0].options = [{ id: id(5), label: "Pollo" }];
  fake.pending[0].resolve(afterFirst);
  await first;
  await tick();
  assert.equal(fake.pending.length, 2);
  assert.deepEqual(fake.pending[1].args, [
    "2026-11-22",
    2,
    id(2),
    ["Limonada"],
  ]);
  // A refresh never runs while a write is pending.
  const reads = fake.calls.filter((call) => call.kind === "today").length;
  await store.refresh();
  assert.equal(
    fake.calls.filter((call) => call.kind === "today").length,
    reads,
  );
  const afterSecond = { ...afterFirst, version: 3 };
  fake.pending[1].resolve(afterSecond);
  await second;
  assert.equal(store.getSnapshot().day.version, 3);
  assert.equal(store.getSnapshot().pending, 0);
});

test("a version conflict reads the day again, drops the queue and keeps nothing optimistic", async () => {
  const fake = fakeApi();
  const store = new editor.DailyMenuEditorStore(fake.api, noTimers);
  await store.refresh();
  const first = store.setOptions(id(1), ["Pollo"]);
  const queued = store.setAddition(id(9), true);
  await tick();
  const theirs = day({ version: 5 });
  theirs.categories[0].options = [{ id: id(6), label: "Res" }];
  fake.state.day = theirs;
  fake.pending[0].reject(
    new editor.DailyMenuApiError(409, "DAILY_MENU_VERSION_CONFLICT"),
  );
  await first;
  await queued;
  const snapshot = store.getSnapshot();
  assert.equal(snapshot.day.version, 5);
  assert.deepEqual(
    snapshot.categories[0].options.map((o) => o.label),
    ["Res"],
  );
  assert.equal(snapshot.additions[0].available, false);
  assert.equal(snapshot.resync, 1);
  assert.equal(
    snapshot.notice.text,
    messages.BACKEND_ERROR_MESSAGES.DAILY_MENU_VERSION_CONFLICT,
  );
  // The queued addition was never sent.
  assert.equal(fake.calls.filter((call) => call.kind === "addition").length, 0);
});

test("without connection the last confirmed state stays and it retries", async () => {
  const fake = fakeApi();
  const scheduled = [];
  const store = new editor.DailyMenuEditorStore(fake.api, {
    set: (fn) => scheduled.push(fn),
    clear: () => {},
  });
  await store.refresh();
  const write = store.setOptions(id(1), ["Pollo"]);
  await tick();
  fake.pending[0].reject(
    new editor.DailyMenuApiError(0, "DAILY_MENU_TEMPORARILY_UNAVAILABLE"),
  );
  await write;
  let snapshot = store.getSnapshot();
  assert.equal(snapshot.offline, true);
  assert.deepEqual(snapshot.categories[0].options, []);
  assert.equal(snapshot.day.version, 1);
  assert.equal(scheduled.length, 1);
  scheduled[0]();
  await tick();
  snapshot = store.getSnapshot();
  assert.equal(snapshot.offline, false);
  assert.equal(editor.OFFLINE_TEXT, "Sin conexión. Reintentando…");
});

test("other refusals drop only that overlay and show the catalogue text", async () => {
  const fake = fakeApi();
  const store = new editor.DailyMenuEditorStore(fake.api, noTimers);
  await store.refresh();
  const write = store.setOptions(id(1), ["Arroz, frijol"]);
  await tick();
  fake.pending[0].reject(
    new editor.DailyMenuApiError(400, "DAILY_MENU_OPTION_INVALID"),
  );
  await write;
  const snapshot = store.getSnapshot();
  assert.deepEqual(snapshot.categories[0].options, []);
  assert.equal(
    snapshot.notice.text,
    messages.BACKEND_ERROR_MESSAGES.DAILY_MENU_OPTION_INVALID,
  );
  assert.equal(snapshot.offline, false);
});

test("copy-yesterday says which categories it skipped; flag off hides the editor", async () => {
  const fake = fakeApi();
  const store = new editor.DailyMenuEditorStore(fake.api, noTimers);
  await store.refresh();
  const copy = store.runAction("copy-yesterday");
  await tick();
  assert.equal(store.getSnapshot().busyAction, "copy-yesterday");
  fake.pending[0].resolve(day({ version: 2, skippedCategories: ["Proteína"] }));
  await copy;
  assert.equal(store.getSnapshot().busyAction, null);
  assert.match(store.getSnapshot().notice.text, /Omitimos Proteína/);

  const off = fakeApi();
  off.state.todayError = new editor.DailyMenuApiError(
    404,
    "DAILY_MENU_DISABLED",
  );
  const hidden = new editor.DailyMenuEditorStore(off.api, noTimers);
  await hidden.refresh();
  assert.equal(hidden.getSnapshot().status, "hidden");
});

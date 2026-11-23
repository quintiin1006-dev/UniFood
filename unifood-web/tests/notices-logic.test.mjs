import { test } from "node:test";
import assert from "node:assert/strict";
import { availabilityLoader } from "./helpers/load-availability.mjs";

// jj/campana-avisos · PR 2: contract, presentation and refresh cadence of the bell inbox.

const load = availabilityLoader();
const { parseNotices, prepareNotices, MAX_NOTICES } = load(
  "features/notices/contracts.ts",
);
const {
  noticeTitle,
  noticeDetail,
  relativeTime,
  exactTime,
  unreadLabel,
  badgeText,
} = load("features/notices/presentation.ts");
const {
  createNoticesRefresher,
  nextNoticesDelay,
  NOTICES_POLL_MS,
  NOTICES_FOCUS_GAP_MS,
} = load("features/notices/state.ts");
const { readNoticesEnabled } = load("config/environment.ts");

const NOW = Date.parse("2026-11-22T17:00:00Z"); // 12:00 in Bogotá
const ORDER = "a1b2c3d4-0000-4000-8000-000000000001";
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const notice = (n, over = {}) => ({
  id: id(n),
  kind: "READY",
  sequence: 0,
  orderId: ORDER,
  orderActive: true,
  createdAt: new Date(NOW - n * 60_000).toISOString(),
  read: false,
  ...over,
});

/* ---------- contract ---------- */

test("the contract keeps only known fields and recomputes unread from the list", () => {
  const parsed = parseNotices(
    {
      unread: 99,
      notices: [
        { ...notice(1), userId: "someone", cafeteriaId: "x" },
        notice(2, { read: true }),
      ],
    },
    NOW,
  );
  assert.equal(parsed.unread, 1);
  assert.deepEqual(Object.keys(parsed.notices[0]).sort(), [
    "createdAt",
    "id",
    "kind",
    "orderActive",
    "orderId",
    "read",
    "sequence",
  ]);
});

test("malformed bodies are refused and malformed or unknown notices are skipped", () => {
  for (const raw of [null, [], "x", { notices: "x" }, {}])
    assert.equal(parseNotices(raw, NOW), null);
  const parsed = parseNotices(
    {
      notices: [
        notice(1, { kind: "SOMETHING_NEW" }),
        notice(2, { id: "not-a-uuid" }),
        notice(3, { kind: "REMINDER", sequence: 0 }),
        notice(4, { kind: "READY", sequence: 2 }),
        notice(5, { createdAt: "yesterday" }),
        notice(6, { read: "no" }),
        notice(7),
      ],
    },
    NOW,
  );
  assert.deepEqual(
    parsed.notices.map((n) => n.id),
    [id(7)],
  );
});

test("newest first, only the last 7 days, at most 20", () => {
  const many = Array.from({ length: 30 }, (_, i) => notice(i + 1));
  many.push(notice(8 * 24 * 60)); // eight days ago
  const shuffled = [...many].reverse();
  const { notices, unread } = prepareNotices(shuffled, NOW);
  assert.equal(MAX_NOTICES, 20);
  assert.equal(notices.length, 20);
  assert.equal(unread, 20);
  assert.equal(notices[0].id, id(1));
  assert.equal(notices[19].id, id(20));
});

test("two reminders of the same order are two notices, the later one first", () => {
  const same = new Date(NOW - 60_000).toISOString();
  const { notices } = prepareNotices(
    [
      notice(1, { kind: "REMINDER", sequence: 1, createdAt: same }),
      notice(2, { kind: "REMINDER", sequence: 2, createdAt: same }),
    ],
    NOW,
  );
  assert.deepEqual(
    notices.map((n) => noticeTitle(n)),
    ["Recordatorio 2", "Recordatorio 1"],
  );
});

/* ---------- presentation ---------- */

test("each kind has its own Spanish title and the detail shows only the order number", () => {
  const titles = [
    "PREPARING",
    "READY",
    "CALLED",
    "DELIVERED",
    "NOT_COLLECTED",
    "REJECTED",
    "CANCELLED_BY_CLIENT",
  ].map((kind) => noticeTitle({ kind, sequence: 0 }));
  assert.equal(new Set(titles).size, titles.length);
  assert.ok(titles.includes("La cafetería rechazó tu pedido"));
  assert.ok(titles.includes("Cancelaste tu pedido"));
  assert.equal(noticeDetail({ orderId: ORDER }), "Pedido #A1B2C3");
});

test("relative times go by minutes, hours and Bogotá calendar days", () => {
  const ago = (ms) => new Date(NOW - ms).toISOString();
  assert.equal(relativeTime(ago(20_000), NOW), "hace un momento");
  assert.equal(relativeTime(ago(5 * 60_000), NOW), "hace 5 min");
  assert.equal(relativeTime(ago(3 * 3_600_000), NOW), "hace 3 h");
  // 23:30 in Bogotá the night before (04:30Z) is «ayer», although less than a day has passed.
  assert.equal(relativeTime("2026-11-22T04:30:00Z", NOW), "ayer");
  assert.equal(relativeTime("2026-11-18T15:00:00Z", NOW), "hace 4 días");
  // A clock slightly ahead of the browser never reads as the future.
  assert.equal(
    relativeTime(new Date(NOW + 5_000).toISOString(), NOW),
    "hace un momento",
  );
});

test("the exact time is in America/Bogota", () => {
  const text = exactTime("2026-11-22T17:05:00Z");
  assert.match(text, /12:05/);
});

test("the unread text is never only a colour", () => {
  assert.equal(unreadLabel(0), "");
  assert.equal(unreadLabel(1), "1 aviso nuevo");
  assert.equal(unreadLabel(3), "3 avisos nuevos");
  assert.equal(badgeText(3), "3");
  assert.equal(badgeText(12), "9+");
});

/* ---------- refresh cadence ---------- */

function harness({ visible = true, results = [] } = {}) {
  let clock = 0;
  const pending = [];
  const timers = {
    set: (callback, ms) => {
      const handle = { callback, ms };
      pending.push(handle);
      return handle;
    },
    clear: (handle) => {
      const index = pending.indexOf(handle);
      if (index >= 0) pending.splice(index, 1);
    },
    now: () => clock,
  };
  const state = { visible, loads: 0 };
  const queue = [...results];
  const refresher = createNoticesRefresher({
    isVisible: () => state.visible,
    load: async () => {
      state.loads += 1;
      return queue.shift() ?? "ok";
    },
    timers,
  });
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  const fire = async () => {
    const next = pending.shift();
    clock += next.ms;
    next.callback();
    await flush();
    return next.ms;
  };
  return {
    refresher,
    state,
    pending,
    flush,
    fire,
    advance: (ms) => (clock += ms),
  };
}

test("it reads at once and then every 60 s, never faster", async () => {
  const h = harness();
  h.refresher.start();
  await h.flush();
  assert.equal(h.state.loads, 1);
  assert.equal(NOTICES_POLL_MS, 60_000);
  assert.deepEqual(
    h.pending.map((p) => p.ms),
    [60_000],
  );
  assert.equal(await h.fire(), 60_000);
  assert.equal(h.state.loads, 2);
  assert.equal(h.pending.length, 1, "one timer at a time");
});

test("hidden pauses the cadence; visible or focus read at once", async () => {
  const h = harness();
  h.refresher.start();
  await h.flush();
  h.state.visible = false;
  h.refresher.visibilityChanged();
  assert.equal(h.pending.length, 0, "no timer while hidden");
  h.advance(10 * 60_000);
  h.state.visible = true;
  h.refresher.visibilityChanged();
  await h.flush();
  assert.equal(h.state.loads, 2);
  h.advance(NOTICES_FOCUS_GAP_MS);
  h.refresher.focused();
  await h.flush();
  assert.equal(h.state.loads, 3);
});

test("a burst of focus events reads once, and a hidden tab never reads", async () => {
  const h = harness();
  h.refresher.start();
  await h.flush();
  for (let i = 0; i < 5; i++) h.refresher.focused();
  await h.flush();
  assert.equal(h.state.loads, 1);
  const hidden = harness({ visible: false });
  hidden.refresher.start();
  hidden.refresher.focused();
  await hidden.flush();
  assert.equal(hidden.state.loads, 0);
  assert.equal(hidden.pending.length, 0);
});

test("failures back off up to five minutes and a disabled inbox stops the loop", async () => {
  assert.equal(nextNoticesDelay(0), 60_000);
  assert.equal(nextNoticesDelay(1), 120_000);
  assert.equal(nextNoticesDelay(10), 300_000);
  const h = harness({ results: ["error", "fatal"] });
  h.refresher.start();
  await h.flush();
  assert.deepEqual(
    h.pending.map((p) => p.ms),
    [120_000],
  );
  await h.fire();
  assert.equal(h.pending.length, 0);
  h.refresher.focused();
  h.refresher.refresh();
  await h.flush();
  assert.equal(h.state.loads, 2);
});

/* ---------- flag ---------- */

test("AVISOS_BANDEJA_ENABLED is off unless it is exactly true", () => {
  assert.equal(readNoticesEnabled({}), false);
  assert.equal(readNoticesEnabled({ AVISOS_BANDEJA_ENABLED: " " }), false);
  assert.equal(readNoticesEnabled({ AVISOS_BANDEJA_ENABLED: "false" }), false);
  assert.equal(readNoticesEnabled({ AVISOS_BANDEJA_ENABLED: "TRUE" }), true);
  assert.throws(() => readNoticesEnabled({ AVISOS_BANDEJA_ENABLED: "yes" }));
});

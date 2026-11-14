import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { availabilityLoader } from "./helpers/load-availability.mjs";

// docs/ui-paneles.md, PR 4 of the worker (W9, D4), designed with design-motion-principles:
// Emil Kowalski as primary lens (frequency gate), Jakub Krehel as secondary.

const css = (file) => fs.readFileSync(file, "utf8");
const files = [
  "components/worker/Header.module.css",
  "components/worker/OrderCard.module.css",
  "components/worker/OrderDetail.module.css",
  "components/worker/BottomNav.module.css",
  "components/worker/CallsBoard.module.css",
  "features/orders/components/OrderActionAlert.module.css",
  "features/orders/components/BoardFeedback.module.css",
];

test("nothing in the worker panel loops, enters on mount or starts at scale(0)", () => {
  for (const file of files) {
    const source = css(file);
    assert.doesNotMatch(source, /infinite/, file);
    assert.doesNotMatch(source, /scale\(0\)/, file);
    assert.doesNotMatch(source, /headerIn|logoIn|navIn/, file);
  }
  const card = css("components/worker/OrderCard.module.css");
  const cardRule = card.slice(
    card.indexOf(".card {"),
    card.indexOf("}", card.indexOf(".card {")),
  );
  assert.doesNotMatch(cardRule, /animation/);
  assert.match(
    card,
    /\.arrived \{\s*animation: cardIn var\(--motion-base, 180ms\)/,
  );
});

test("hover never lifts and presses sink to 0.98 at most", () => {
  for (const file of files) {
    const source = css(file);
    for (const match of source.matchAll(/:hover[^{]*\{([^}]*)\}/g))
      assert.doesNotMatch(match[1], /transform/, `${file}: ${match[0]}`);
    for (const match of source.matchAll(/transform: scale\((0\.\d+)\)/g))
      assert.ok(Number(match[1]) >= 0.98, `${file}: ${match[0]}`);
  }
});

test("every animated worker file has a reduced-motion path, and the detail has no blur", () => {
  for (const file of files.slice(0, 6))
    assert.match(css(file), /prefers-reduced-motion: reduce/, file);
  const detail = css("components/worker/OrderDetail.module.css");
  assert.doesNotMatch(detail, /backdrop-filter/);
  assert.match(detail, /animation: modalIn 200ms/);
});

test("motion tokens sit on the panel root, not in the shared globals", () => {
  const tokens = css("features/orders/components/motion.module.css");
  for (const token of [
    "--motion-fast: 120ms",
    "--motion-base: 180ms",
    "--motion-dialog: 220ms",
    "--ease-out: cubic-bezier(0.2, 0, 0, 1)",
  ])
    assert.ok(tokens.includes(token), token);
  assert.match(
    css("components/worker/WorkerDashboard.tsx"),
    /worker-page \$\{motion\.tokens\}/,
  );
  assert.doesNotMatch(css("app/globals.css"), /--motion-/);
});

test("opening the board animates no card: only a column change does", () => {
  const { default: KanbanBoard } = availabilityLoader()(
    "components/worker/KanbanBoard.tsx",
  );
  const html = renderToStaticMarkup(
    React.createElement(KanbanBoard, {
      orders: ["pending", "preparing", "ready"].map((status, i) => ({
        id: `id-${i}`,
        student: `Cliente ${i}`,
        createdAt: "2026-11-20T16:00:00Z",
        updatedAt: "2026-11-20T16:00:00Z",
        items: [],
        status,
      })),
      busyOrderIds: [],
      newOrderIds: {},
      now: 0,
      onOpenOrder() {},
      onAction() {},
    }),
  );
  assert.equal((html.match(/class="card /g) ?? []).length, 3);
  assert.doesNotMatch(html, /\barrived\b/);
});

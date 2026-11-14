import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { availabilityLoader } from "./helpers/load-availability.mjs";

// docs/ui-paneles.md, «Tokens» (ola 2, T1).

const load = () => availabilityLoader();
const tokens = fs.readFileSync("app/tokens.css", "utf8");

test("tokens carry the approved values exactly", () => {
  for (const [name, value] of [
    ["--color-ink", "#0f172a"],
    ["--color-text-soft", "#64708a"],
    ["--color-slate", "#475266"],
    ["--color-brand", "#1e4fd8"],
    ["--color-brand-hover", "#1a40ae"],
    ["--color-brand-tint", "#eef3ff"],
    ["--color-brand-tint-2", "#dce6fb"],
    ["--color-bg", "#f6f7f9"],
    ["--color-surface", "#ffffff"],
    ["--color-line", "#e5e8ee"],
    ["--color-success", "#2e7d5b"],
    ["--color-success-bg", "#e6f2ec"],
    ["--color-success-ink", "#1f5e43"],
    ["--color-danger", "#c8323a"],
    ["--color-danger-bg", "#fdecee"],
    ["--color-danger-ink", "#9e2530"],
    ["--color-neutral-chip-bg", "#eef0f4"],
    ["--color-neutral-chip-ink", "#475266"],
    ["--radius-sm", "12px"],
    ["--radius-md", "20px"],
    ["--radius-lg", "28px"],
    ["--radius-arch", "12px 12px 28px 28px"],
    ["--shadow-raised", "0 12px 24px -16px rgba(15, 23, 42, 0.25)"],
  ])
    assert.match(
      tokens,
      new RegExp(`${name}: ${value.replace(/[()]/g, "\\$&")};`),
      name,
    );
});

test("the root layout loads Figtree through next/font and the tokens before globals", () => {
  const layout = fs.readFileSync("app/layout.tsx", "utf8");
  assert.match(layout, /from "next\/font\/google"/);
  assert.match(layout, /weight: \["500", "600", "700", "800"\]/);
  assert.ok(
    layout.indexOf('"./tokens.css"') < layout.indexOf('"./globals.css"'),
  );
  assert.doesNotMatch(layout, /fonts\.googleapis/);
});

test("shared components use tokens only, never a loose hex", () => {
  for (const file of fs.readdirSync("components/ui"))
    assert.doesNotMatch(
      fs.readFileSync(`components/ui/${file}`, "utf8"),
      /#[0-9a-f]{3,8}\b/i,
      file,
    );
});

test("one status map for worker, admin and client", () => {
  const { orderStatusTone, ORDER_STATUS_LABELS } = load()(
    "components/ui/orderStatus.ts",
  );
  assert.equal(orderStatusTone("pending"), "pending");
  assert.equal(orderStatusTone("CALLED"), "called");
  assert.equal(orderStatusTone("NOT_COLLECTED"), "notCollected");
  assert.equal(orderStatusTone("CANCELLED", "WORKER"), "rejected");
  assert.equal(orderStatusTone("CANCELLED", "CLIENT"), "cancelled");
  assert.equal(ORDER_STATUS_LABELS.preparing, "En preparación");
  const { StatusChip } = load()("components/ui/StatusChip.tsx");
  const html = renderToStaticMarkup(
    React.createElement(StatusChip, { status: "READY" }),
  );
  assert.match(html, /data-tone="ready"/);
  assert.match(html, /chip_ready/);
  assert.match(html, />Listo</);
});

test("danger is never taller than primary and every chip tone has a style", () => {
  const css = fs.readFileSync("components/ui/ui.module.css", "utf8");
  const height = (rule) =>
    Number(
      new RegExp(`\\.${rule} \\{[^}]*min-height: (\\d+)px`).exec(css)?.[1],
    );
  assert.equal(height("button"), 48);
  assert.equal(height("button_touch"), 56);
  assert.ok(height("button_danger") <= height("button"));
  for (const tone of [
    "pending",
    "preparing",
    "ready",
    "called",
    "delivered",
    "rejected",
    "notCollected",
  ])
    assert.match(css, new RegExp(`\\.chip_${tone}`), tone);
  assert.match(css, /prefers-reduced-motion: reduce/);
});

test("Notice: errors are alerts, success and information are polite", () => {
  const { Notice } = load()("components/ui/Notice.tsx");
  const render = (tone) =>
    renderToStaticMarkup(React.createElement(Notice, { tone }, "Texto"));
  assert.match(render("error"), /role="alert"/);
  assert.match(render("success"), /role="status"/);
  assert.match(render("info"), /role="status"/);
});

test("repeated texts come from one catalogue without changing their wording", () => {
  const { SESSION_CHECK_UNAVAILABLE } = load()("lib/messages.ts");
  assert.equal(
    SESSION_CHECK_UNAVAILABLE,
    "No pudimos verificar tu sesión en este momento. Inténtalo nuevamente.",
  );
  const { AVAILABILITY_MESSAGES } = load()("features/availability/errors.ts");
  assert.equal(
    AVAILABILITY_MESSAGES.AUTH_TEMPORARILY_UNAVAILABLE,
    SESSION_CHECK_UNAVAILABLE,
  );
});

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { availabilityLoader } from "./helpers/load-availability.mjs";

// jj/cliente-ajustes-2 · C: one connection notice with the brand's colors.

const read = (file) => fs.readFileSync(file, "utf8");
const render = (props) => {
  const { ConnectionNotice } = availabilityLoader()(
    "features/shared/components/ConnectionNotice.tsx",
  );
  return renderToStaticMarkup(React.createElement(ConnectionNotice, props));
};

test("a network drop is a calm blue status with a cloud and a secondary «Reintentar»", () => {
  const html = render({ children: "Sin conexión.", onRetry() {} });
  assert.match(html, /role="status"/);
  assert.match(html, /data-tone="offline"/);
  assert.match(html, /lucide-cloud-off/);
  assert.match(html, /width:calc\(20px/);
  assert.match(html, /class="retry"[^>]*>.*Reintentar/);
  assert.doesNotMatch(html, /role="alert"/);
  const busy = render({ children: "x", onRetry() {}, retrying: true });
  assert.match(busy, /disabled=""/);
  assert.match(busy, /Reintentando…/);
  assert.doesNotMatch(render({ children: "x" }), /<button/);
});

test("its colors are the brand's, never red, and its spin respects reduced motion", () => {
  const css = read("features/shared/components/ConnectionNotice.module.css");
  assert.match(
    css,
    /data-surface="light"\] \{[^}]*background: #eaf4ff;[^}]*color: #0b2d6b;/,
  );
  assert.match(css, /data-surface="glass"\] \{[^}]*color: #ffffff;/);
  assert.doesNotMatch(css, /--color-danger/);
  assert.match(
    css,
    /prefers-reduced-motion: reduce\) \{\s*\.spin \{\s*animation: none;/,
  );
  assert.match(css, /\.retry \{[^}]*min-height: calc\(44px/);
});

test("every old banner uses it now", () => {
  for (const file of [
    "features/orders/components/BoardFeedback.tsx",
    "features/worker-history/components/WorkerHistoryPanel.tsx",
    "features/availability/components/AvailabilityPanel.tsx",
    "features/client/components/ClientHome.tsx",
    "features/client/components/ClientMenu.tsx",
    "features/client-orders/components/MyOrder.tsx",
  ]) {
    const source = read(file);
    assert.match(source, /<ConnectionNotice/, file);
    assert.doesNotMatch(
      source,
      /OFFLINE_RETRYING|tone="error"\s*\n?\s*action=/,
      file,
    );
  }
  // Historial without data: a soft error, not the big red box.
  assert.match(
    read("features/worker-history/components/WorkerHistoryPanel.tsx"),
    /tone=\{state\.data \? "offline" : "error"\}/,
  );
});

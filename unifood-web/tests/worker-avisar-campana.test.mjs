import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// Ola 4 · campana «Avisar» de Llamadas (clásico): liviana, con área táctil de 44 px reales.

test("classic remind button has a soft box with no hard border and a 44 px invisible hit area", () => {
  const css = fs.readFileSync(
    "components/worker/CallsBoard.classic.module.css",
    "utf8",
  );
  const block = css.slice(
    css.indexOf(".remindButton.remindButton {"),
    css.indexOf(".remindButton.remindButton:hover"),
  );
  assert.match(block, /border: 0;/);
  assert.match(block, /background: #f0f6ff;/);
  assert.doesNotMatch(block, /border: 1px solid/);
  const hit = css.slice(
    css.indexOf(".remindButton.remindButton::before"),
    css.indexOf(".remindButton.remindButton:hover"),
  );
  assert.match(hit, /width: calc\(44px \/ var\(--worker-zoom, 1\)\);/);
  assert.match(hit, /height: calc\(44px \/ var\(--worker-zoom, 1\)\);/);
});

test("D5: no visible counter: the bell is an icon-only 44 px button", () => {
  const css = fs.readFileSync(
    "components/worker/CallsBoard.classic.module.css",
    "utf8",
  );
  assert.doesNotMatch(css, /\.remindButton\.remindButton > span/);
  const last = css.slice(css.lastIndexOf(".remindButton.remindButton {"));
  assert.match(last, /width: calc\(44px \/ var\(--worker-zoom, 1\)\);/);
  assert.match(last, /height: calc\(44px \/ var\(--worker-zoom, 1\)\);/);
});

test("the bell uses the set's 1.8 stroke at 20 real px", () => {
  const src = fs.readFileSync(
    "features/orders/components/CalledOrderActions.tsx",
    "utf8",
  );
  assert.match(
    src,
    /<Bell\s+size=\{20\}\s+style=\{ICON_MIN_20\}\s+strokeWidth=\{1\.8\}/,
  );
});

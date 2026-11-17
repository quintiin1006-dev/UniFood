import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { availabilityLoader } from "./helpers/load-availability.mjs";

// Ola 4 · F3: a worker action answers at once with a spinner and «Guardando…» while the server confirms.

const order = (overrides = {}) => ({
  id: "00000000-0000-0000-0000-000000000092",
  student: "Laura Gómez",
  clientCode: "1234567",
  clientType: "STUDENT",
  createdAt: "2026-11-20T16:00:00Z",
  updatedAt: "2026-11-20T16:00:00Z",
  items: [],
  status: "pending",
  ...overrides,
});
const render = (file, props, name) => {
  const mod = availabilityLoader()(file);
  return renderToStaticMarkup(
    React.createElement(name ? mod[name] : mod.default, props),
  );
};

for (const variant of ["classic", "modern"]) {
  test(`${variant} card: a busy action shows a spinner, «Guardando…» and aria-busy`, () => {
    const idle = render("components/worker/OrderCard.tsx", {
      variant,
      order: order(),
      onOpen() {},
      onAction() {},
    });
    assert.doesNotMatch(idle, /Guardando…/);
    assert.doesNotMatch(idle, /aria-busy/);

    const busy = render("components/worker/OrderCard.tsx", {
      variant,
      order: order(),
      onOpen() {},
      onAction() {},
      busy: true,
    });
    assert.match(busy, /aria-busy="true"/);
    assert.match(busy, />Guardando…</);
    assert.match(busy, /class="spinner[^"]*" aria-hidden="true"/);
    // The accessible name stays the action, so the button is still found by what it does.
    const actionName = (html) =>
      html.match(
        /<button[^>]*data-status="pending"[^>]*aria-label="([^"]+)"/,
      )?.[1];
    assert.ok(actionName(idle));
    assert.equal(actionName(busy), actionName(idle));
  });
}

test("detail panel: a busy action shows the spinner and «Guardando…»", () => {
  const busy = render("components/worker/OrderDetail.tsx", {
    order: order(),
    onClose() {},
    onAction() {},
    busy: true,
  });
  assert.match(busy, /aria-busy="true"/);
  assert.match(busy, />Guardando…</);
});

test("shared Button: loading disables it, marks it busy and adds the spinner", () => {
  const { Button } = availabilityLoader()("components/ui/Button.tsx");
  const html = renderToStaticMarkup(
    React.createElement(Button, { loading: true }, "Guardando…"),
  );
  assert.match(html, /disabled=""/);
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /class="spinner[^"]*"/);
  const idle = renderToStaticMarkup(React.createElement(Button, {}, "Guardar"));
  assert.doesNotMatch(idle, /aria-busy|spinner|disabled/);
});

test("reduced motion stops the shared spinner", () => {
  const css = fs.readFileSync("components/ui/ui.module.css", "utf8");
  assert.match(
    css,
    /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*\.spinner \{\s*animation: none;/,
  );
});

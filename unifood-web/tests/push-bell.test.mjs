import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { availabilityLoader } from "./helpers/load-availability.mjs";

// Ola 4 · campana de avisos en el encabezado del cliente: estado y nombre accesible.

function render(view) {
  const load = availabilityLoader({
    mocks: {
      "../usePush": { usePush: () => view },
      "./PushControls": {
        PushUnavailable: ({ availability }) =>
          React.createElement(
            "p",
            { "data-unavailable": availability },
            availability,
          ),
      },
    },
  });
  const { default: PushBell } = load("features/push/components/PushBell.tsx");
  return renderToStaticMarkup(React.createElement(PushBell));
}

const base = { busy: false, message: null, enable() {}, disable() {} };

test("before the browser is inspected the bell keeps its space and shows nothing", () => {
  const html = render({ ...base, availability: null, subscribed: false });
  assert.match(html, /<span[^>]*aria-hidden="true"/);
  assert.doesNotMatch(html, /<button/);
});

test("with push off the bell says so and uses the muted icon", () => {
  const html = render({
    ...base,
    availability: "available",
    subscribed: false,
  });
  assert.match(html, /aria-label="Avisos desactivados\. Abrir opciones\."/);
  assert.match(html, /aria-expanded="false"/);
});

test("with push on the bell says so and uses the active icon", () => {
  const html = render({ ...base, availability: "available", subscribed: true });
  assert.match(html, /aria-label="Avisos activados\. Abrir opciones\."/);
});

test("a browser that cannot receive push is explained by the shared notice, not hidden", () => {
  const html = render({
    ...base,
    availability: "unsupported",
    subscribed: false,
  });
  assert.match(html, /<button/);
  assert.doesNotMatch(html, /data-unavailable="unsupported"/); // only shown once opened
});

test("the bell reuses the Perfil logic: no push calls of its own", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync("features/push/components/PushBell.tsx", "utf8");
  assert.match(src, /from "\.\.\/usePush"/);
  assert.match(src, /PushUnavailable/);
  assert.doesNotMatch(
    src,
    /navigator\.serviceWorker|saveSubscription|removeSubscription/,
  );
});

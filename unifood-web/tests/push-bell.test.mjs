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
  assert.match(
    html,
    /aria-label="Notificaciones desactivadas\. Abrir opciones\."/,
  );
  assert.match(html, /aria-expanded="false"/);
  // C4: a dot on the bell when they are off.
  assert.match(html, /data-on="false"/);
});

test("with push on the bell says so and uses the active icon", () => {
  const html = render({ ...base, availability: "available", subscribed: true });
  assert.match(
    html,
    /aria-label="Notificaciones activadas\. Abrir opciones\."/,
  );
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

test("C4: the bell is the one switch, with visible state, one action, a blocked line and a dot", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync("features/push/components/PushBell.tsx", "utf8");
  const { loadTs } = await import("./helpers/load-ts.mjs");
  const { PUSH_MESSAGES } = loadTs("features/shared/messages.ts");
  assert.equal(PUSH_MESSAGES.bellStatusOn, "Notificaciones activadas");
  assert.equal(PUSH_MESSAGES.bellStatusOff, "Notificaciones desactivadas");
  assert.equal(PUSH_MESSAGES.bellEnable, "Activar notificaciones");
  assert.equal(PUSH_MESSAGES.bellDisable, "Desactivar notificaciones");
  assert.match(
    src,
    /view\.availability === "denied" \? \(\s*<p className=\{styles\.hint\}>\{PUSH_MESSAGES\.bellBlocked\}/,
  );
  // Turning it off also mutes the Mi pedido chime.
  assert.match(src, /writeMuted\(true\)/);
  // Ready for the recent list, not implemented.
  assert.match(src, /data-slot="recent"/);
  const css = fs.readFileSync(
    "features/push/components/PushBell.module.css",
    "utf8",
  );
  assert.match(css, /\.bell\[data-on="false"\]::after/);
  assert.match(css, /\.bell \{[^}]*width: 44px;/);
});

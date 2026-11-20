import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { availabilityLoader } from "./helpers/load-availability.mjs";

// jj/cliente-ajustes-2 · D: the worker header, its search and «Actualizado», and Historial.

const read = (file) => fs.readFileSync(file, "utf8");
const header = (props) => {
  const load = availabilityLoader({
    mocks: {
      "next/image": {
        __esModule: true,
        default: (p) => React.createElement("img", { alt: p.alt }),
      },
      "@/features/auth/components/LogoutButton": {
        __esModule: true,
        default: () => React.createElement("button", null, "Cerrar sesión"),
      },
    },
  });
  const Header = load("components/worker/Header.tsx").default;
  return renderToStaticMarkup(
    React.createElement(Header, { search: "", onSearchChange() {}, ...props }),
  );
};

test("D1: only the logo and «UniFood» on the left, no module name, 64 px in every module", () => {
  for (const activeModule of [
    "orders",
    "calls",
    "history",
    "availability",
    "profile",
  ]) {
    const html = header({ activeModule });
    assert.match(html, /<h1>Uni<span>Food<\/span><\/h1>/, activeModule);
    assert.doesNotMatch(
      html,
      /Gestión de pedidos|<p>(Llamadas|Historial|Disponibilidad|Mi perfil)<\/p>/,
      activeModule,
    );
  }
  const css = read("components/worker/Header.classic.module.css");
  assert.match(css, /height: calc\(64px \/ var\(--worker-zoom, 1\)\);/);
  assert.doesNotMatch(css, /\.brandInfo p \{/);
});

test("D2: the search grows between the brand and the actions, 44 px tall, with a comfortable maximum", () => {
  const html = header({ activeModule: "orders" });
  assert.ok(
    html.indexOf('class="center"') < html.indexOf('class="actions"'),
    "the search sits before the actions",
  );
  const css = read("components/worker/Header.classic.module.css");
  assert.match(
    css,
    /\.center \{[^}]*flex: 1 1 auto;[^}]*justify-content: center;/,
  );
  assert.match(css, /\.center \{[^}]*padding: 0 calc\(24px/);
  assert.match(css, /\.search \{[^}]*width: 100%;[^}]*max-width: calc\(560px/);
  assert.match(css, /\.search \{[^}]*height: calc\(44px/);
  assert.doesNotMatch(header({ activeModule: "history" }), /role="search"/);
});

test("status: one element, green dot when synced, pulses while refreshing, red offline", () => {
  const ok = { text: "Actualizado a las 10:42", time: "10:42", tone: "ok" };
  const idle = header({ activeModule: "orders", syncStatus: ok });
  // A single status element, no glass pill and no second «Sin conexión» box.
  assert.equal(idle.match(/role="status"/g).length, 1);
  assert.match(idle, /aria-live="polite"/);
  assert.match(idle, /statusDot/);
  assert.match(idle, /<span>Actualizado a las 10:42<\/span>/);
  assert.doesNotMatch(
    idle,
    /statusRefreshing|statusWarning|<svg[^>]*recargar|<time>/,
  );

  const busy = header({
    activeModule: "orders",
    syncStatus: ok,
    refreshing: true,
  });
  assert.match(busy, /statusRefreshing/);
  assert.match(busy, /aria-busy="true"/);
  assert.equal(busy.match(/role="status"/g).length, 1);

  const off = header({
    activeModule: "calls",
    syncStatus: { text: "Sin conexión", tone: "warning" },
  });
  assert.equal(off.match(/role="status"/g).length, 1);
  assert.equal(off.match(/Sin conexión/g).length, 2); // the text and its title
  assert.match(off, /statusWarning/);

  const css = read("components/worker/Header.classic.module.css");
  const pill = css.match(/\.status \{[^}]*\}/)[0];
  assert.doesNotMatch(pill, /border|background|backdrop-filter/);
  assert.match(css, /\.statusDot \{[^}]*background: var\(--color-success\);/);
  assert.match(css, /\.statusWarning \{\s*color: var\(--color-danger-ink\);/);
  assert.match(
    css,
    /\.statusWarning \.statusDot \{\s*background: var\(--color-danger\);/,
  );
  assert.match(css, /\.statusRefreshing \.statusDot \{\s*animation: pulse/);
  assert.match(
    css,
    /prefers-reduced-motion: reduce\) \{[^}]*\.statusRefreshing \.statusDot \{\s*animation: none;/,
  );
  assert.doesNotMatch(css, /statusSpin|statusLabel/);
  assert.match(
    read("features/orders/hooks/useOrders.ts"),
    /setRefreshing\(true\);/,
  );
});

test("D4 and D5: no range beside the filters; open, the whole row is the white card", () => {
  assert.doesNotMatch(
    read("features/worker-history/components/WorkerHistoryPanel.tsx"),
    /styles\.range|formatShortRange/,
  );
  const css = read(
    "features/worker-history/components/WorkerHistory.module.css",
  );
  assert.match(
    css,
    /\.row\[data-open\] \{[^}]*background: #ffffff;[^}]*color: var\(--color-ink\);/,
  );
  assert.match(
    css,
    /\.row\[data-open\] \.rowName \{\s*color: var\(--color-brand-navy\);/,
  );
  assert.match(css, /\.detail \{[^}]*overflow: hidden;/);
  assert.doesNotMatch(css.match(/\.detail \{[^}]*\}/)[0], /background/);
  assert.match(
    css,
    /@keyframes detail-open \{\s*from \{\s*grid-template-rows: 0fr;/,
  );
  assert.match(css, /\.detailWrap \{\s*animation: none;/);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { availabilityLoader } from "./helpers/load-availability.mjs";

// jj/campana-avisos · PR 2: the bell with the inbox, and the bell exactly as before without it.

const pushView = {
  availability: "available",
  subscribed: true,
  busy: false,
  message: null,
  enable() {},
  disable() {},
};
const inboxView = (over = {}) => ({
  status: "ready",
  notices: [],
  unread: 0,
  readAt: 0,
  message: null,
  retry() {},
  markAllRead() {},
  ...over,
});

function loadWith({ push = pushView, inbox = inboxView() } = {}) {
  return availabilityLoader({
    mocks: {
      "../usePush": { usePush: () => push },
      "@/features/push/usePush": { usePush: () => push },
      "../useNotices": { useNotices: () => inbox },
      "next/link": {
        __esModule: true,
        default: ({ href, children, ...rest }) =>
          React.createElement("a", { href, ...rest }, children),
      },
    },
  });
}

const renderBell = (props, options) => {
  const { default: PushBell } = loadWith(options)(
    "features/push/components/PushBell.tsx",
  );
  return renderToStaticMarkup(React.createElement(PushBell, props));
};

test("with the inbox off the bell is the plain switch, without badge or dialog", () => {
  const html = renderBell({});
  assert.match(
    html,
    /aria-label="Notificaciones activadas\. Abrir opciones\."/,
  );
  assert.doesNotMatch(html, /aria-haspopup/);
  const legacy = renderBell({ inbox: false });
  assert.equal(legacy, html);
});

test("with unread notices the bell says how many in words, not only with a dot", () => {
  const html = renderBell({ inbox: true }, { inbox: inboxView({ unread: 3 }) });
  assert.match(
    html,
    /aria-label="3 avisos nuevos\. Notificaciones activadas\. Abrir opciones\."/,
  );
  assert.match(html, /aria-haspopup="dialog"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, />3<\/span>/);
  assert.match(html, /role="status"[^>]*>3 avisos nuevos</);
});

test("with nothing unread there is no badge and the name is the switch's", () => {
  const html = renderBell({ inbox: true });
  assert.match(
    html,
    /aria-label="Notificaciones activadas\. Abrir opciones\."/,
  );
  assert.doesNotMatch(html, /avisos nuevos/);
});

/* ---------- the list ---------- */

const NOW = Date.parse("2026-11-22T17:00:00Z");
const notice = (n, over = {}) => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  kind: "READY",
  sequence: 0,
  orderId: "a1b2c3d4-0000-4000-8000-000000000001",
  orderActive: false,
  createdAt: new Date(NOW - n * 60_000).toISOString(),
  read: true,
  ...over,
});

function renderList(view, fresh = new Set()) {
  const { default: NoticesList } = loadWith()(
    "features/notices/components/NoticesList.tsx",
  );
  return renderToStaticMarkup(
    React.createElement(NoticesList, {
      view: { retry() {}, message: null, ...view },
      now: NOW,
      fresh,
      titleId: "t",
      onNavigate() {},
    }),
  );
}

test("empty, loading and error states have their texts and the error a retry", () => {
  assert.match(
    renderList({ status: "ready", notices: [] }),
    /Aún no tienes avisos\. Cuando tu pedido cambie de estado, aparecerá aquí\./,
  );
  assert.match(
    renderList({ status: "loading", notices: [] }),
    /role="status"[^>]*>Cargando avisos/,
  );
  const error = renderList({
    status: "error",
    notices: [],
    message: "No pudimos cargar tus avisos.",
  });
  assert.match(error, /role="alert"/);
  assert.match(error, /<button[^>]*>.*Reintentar<\/button>/);
});

test("an active order links to Mi pedido; a finished one is a plain row", () => {
  const html = renderList({
    status: "ready",
    notices: [
      notice(1, { kind: "CALLED", orderActive: true }),
      notice(2, { kind: "DELIVERED" }),
    ],
  });
  assert.equal((html.match(/<a /g) ?? []).length, 1);
  assert.match(html, /<a href="\/cuenta\/pedido"[^>]*>.*Te estamos llamando/);
  assert.match(html, /Pedido entregado/);
  assert.match(html, /Pedido #A1B2C3/);
  assert.match(html, /<time[^>]*dateTime="2026-11-22T16:59:00.000Z"/i);
  assert.match(html, /hace 1 min · /);
});

test("two reminders in a row are two rows, and fresh ones say «Nuevo»", () => {
  const first = notice(1, { kind: "REMINDER", sequence: 2 });
  const html = renderList(
    {
      status: "ready",
      notices: [first, notice(2, { kind: "REMINDER", sequence: 1 })],
    },
    new Set([first.id]),
  );
  assert.equal((html.match(/<li /g) ?? []).length, 2);
  assert.match(html, /Recordatorio 2.*Nuevo.*Recordatorio 1/);
  assert.equal((html.match(/Nuevo/g) ?? []).length, 1);
});

test("icons are at least 20 px, hidden from screen readers; no Spanish text is hard-coded", () => {
  const html = renderList({
    status: "ready",
    notices: [notice(1)],
  });
  assert.match(
    html,
    /<svg[^>]*width="20"[^>]*height="20"[^>]*aria-hidden="true"/,
  );
  for (const file of [
    "features/notices/components/NoticesList.tsx",
    "features/notices/components/InboxBell.tsx",
  ]) {
    const source = fs.readFileSync(file, "utf8");
    const jsxText = [
      ...source.matchAll(/>\s*([^<>{}\n]*[áéíóúñ¿¡][^<>{}\n]*)\s*</g),
    ].map((match) => match[1].trim());
    assert.deepEqual(jsxText, [], file);
  }
});

test("the panel is a labelled dialog with Escape, focus trap and reduced motion handled", () => {
  const source = fs.readFileSync(
    "features/notices/components/InboxBell.tsx",
    "utf8",
  );
  assert.match(source, /role="dialog"/);
  assert.match(source, /aria-labelledby=\{titleId\}/);
  assert.match(source, /event\.key === "Escape"/);
  assert.match(source, /event\.key !== "Tab"/);
  assert.match(source, /bellRef\.current\?\.focus\(\)/);
  const css = fs.readFileSync(
    "features/notices/components/InboxBell.module.css",
    "utf8",
  );
  assert.match(css, /prefers-reduced-motion: no-preference/);
  assert.doesNotMatch(
    css.replace(
      /@media \(prefers-reduced-motion: no-preference\)[\s\S]*?\n\}/g,
      "",
    ),
    /animation:|transition:/,
  );
  assert.match(css, /env\(safe-area-inset-bottom\)/);
});

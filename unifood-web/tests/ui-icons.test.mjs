import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { availabilityLoader } from "./helpers/load-availability.mjs";

// Ola 4 · F1: UniFood's own icon set (approved 7-nov-2026, proposal 2) and the glyphs drawn for it.

const icons = () => availabilityLoader()("components/ui/Icon.tsx");
const render = (props) =>
  renderToStaticMarkup(React.createElement(icons().Icon, props));

const OWNER = [
  "inicio",
  "mi-pedido",
  "carrito",
  "historial",
  "perfil",
  "pedidos",
  "disponibilidad",
  "dashboard",
  "catalogo",
  "universidades",
  "cafeterias",
  "suscripciones",
  "clientes",
];

test("the owner's thirteen glyphs are all in the set, unchanged in name", () => {
  assert.deepEqual(icons().OWNER_ICON_NAMES, OWNER);
});

test("every glyph follows the rules: 24×24, stroke 1.8, round, no fill, currentColor", () => {
  for (const name of icons().ICON_NAMES) {
    const svg = render({ name });
    assert.match(svg, /viewBox="0 0 24 24"/, name);
    assert.match(svg, /stroke-width="1.8"/, name);
    assert.match(svg, /stroke-linecap="round"/, name);
    assert.match(svg, /stroke-linejoin="round"/, name);
    assert.match(svg, /fill="none"/, name);
    assert.match(svg, /stroke="currentColor"/, name);
    // Every glyph draws something, and no glyph carries its own colour.
    assert.match(svg, /<(path|circle|rect)/, name);
    assert.doesNotMatch(
      svg.replace(/stroke="currentColor"/, ""),
      /#[0-9a-f]{3,6}/i,
      name,
    );
  }
});

test("decorative by default; announced with a label when it is a button's only content", () => {
  const decorative = render({ name: "carrito" });
  assert.match(decorative, /aria-hidden="true"/);
  assert.doesNotMatch(decorative, /role="img"/);
  const labelled = render({ name: "cerrar", label: "Cerrar búsqueda" });
  assert.match(labelled, /role="img"/);
  assert.match(labelled, /aria-label="Cerrar búsqueda"/);
  assert.doesNotMatch(labelled, /aria-hidden/);
});

test("colours come from tokens: inactive soft text, active brand with a 14 % fill, tile gradient", () => {
  const css = fs.readFileSync("components/ui/icon.module.css", "utf8");
  assert.match(css, /\.inactive \{\s*color: var\(--color-text-soft\);/);
  assert.match(
    css,
    /\.active \{\s*color: var\(--color-brand\);\s*fill: color-mix\(in srgb, var\(--color-brand\) 14%, transparent\);/,
  );
  assert.match(css, /width: 48px;\s*height: 48px;/);
  assert.match(css, /border-radius: 14px;/);
  assert.match(
    css,
    /linear-gradient\(\s*150deg,\s*var\(--color-brand-celeste\) 0%,\s*var\(--color-brand\) 45%,\s*var\(--color-brand-navy\) 100%\s*\)/,
  );
  assert.doesNotMatch(css, /#[0-9a-f]{3,6}\b/i);
  const tile = renderToStaticMarkup(
    React.createElement(icons().IconTile, { name: "pedidos" }),
  );
  assert.match(tile, /stroke-width="1.9"/);
});

test("navigation of every role uses the set, not a generic icon library", () => {
  for (const file of [
    "features/client/components/ClientBottomNav.tsx",
    "components/worker/BottomNav.tsx",
    "components/worker/Header.tsx",
    "components/worker/KanbanBoard.tsx",
    "components/worker/OrderCard.tsx",
    "features/admin/components/AdminSidebar.tsx",
    "features/admin/components/AdminHeader.tsx",
    "features/super-admin/components/SuperAdminPanel.tsx",
    "lib/orderWorkflow.ts",
  ]) {
    const source = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(source, /lucide-react|react-icons/, file);
    assert.match(source, /@\/components\/ui\/Icon/, file);
  }
});

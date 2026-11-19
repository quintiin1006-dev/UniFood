import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// jj/cliente-ajustes: correcciones del cliente (C1 a C5).

const read = (file) => fs.readFileSync(file, "utf8");

test("C1: «Conservar carrito» has no blue outline and the open dialog draws no focus lines", () => {
  const dialog = read("features/client/components/ConfirmDialog.tsx");
  assert.match(dialog, /className=\{styles\.keepButton\}/);
  assert.doesNotMatch(dialog, /autoFocus/);
  const shell = read("features/client/components/ClientDialog.tsx");
  assert.match(shell, /<h2 id=\{titleId\} tabIndex=\{-1\} autoFocus>/);
  const css = read("features/client/components/ClientShopping.module.css");
  assert.match(css, /\.dialog,\s*\.dialog h2 \{\s*outline: none;/);
  const keep = css.match(/\.keepButton \{[^}]*\}/)[0];
  assert.match(keep, /border: 0;/);
  assert.match(keep, /min-height: 50px;/);
});

test("C2: the current cafeteria on Inicio opens the available ones in place, without navigating", () => {
  const home = read("features/client/components/ClientHome.tsx");
  assert.match(home, /<CafeteriaPicker/);
  assert.doesNotMatch(home, /CafeteriaSelector/);
  const picker = read("features/client/components/CafeteriaPicker.tsx");
  // A disclosure button, not a link to the selection screen.
  assert.match(picker, /aria-expanded=\{open\}/);
  assert.match(picker, /aria-controls=\{listId\}/);
  assert.doesNotMatch(picker, /CHANGE_CAFETERIA_HREF|href=/);
  // Each other cafeteria goes through CafeteriaLink (it asks before emptying the cart).
  assert.match(picker, /<CafeteriaLink/);
  assert.match(picker, /aria-current="true"/);
  assert.match(picker, /event\.key !== "Escape"/);
  assert.match(read("app/cuenta/page.tsx"), /sites=\{context\.sites\}/);
  const css = read("features/client/components/HomeSections.module.css");
  assert.match(css, /\.pickerOption \{[^}]*min-height: 48px;/);
  assert.match(
    css,
    /prefers-reduced-motion: reduce\) \{\s*\.pickerPanel \{\s*animation: none;/,
  );
});

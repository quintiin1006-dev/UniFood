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

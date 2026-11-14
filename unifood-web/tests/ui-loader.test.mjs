import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { availabilityLoader } from "./helpers/load-availability.mjs";

// Ola 2 · D1: loader (ring around the mark) and content skeletons.

test("the loader is invisible for 300 ms and reduced motion stops the ring", () => {
  const css = fs.readFileSync("components/ui/loader.module.css", "utf8");
  assert.match(
    css,
    /\.loader \{[^}]*animation: appear 200ms var\(--ease-soft\) 300ms both/,
  );
  assert.match(
    css,
    /\.skeleton \{[^}]*animation: appear 200ms var\(--ease-soft\) 300ms both/,
  );
  assert.match(
    css,
    /@media \(prefers-reduced-motion: reduce\) \{\s*\.arc \{\s*animation: none;/,
  );
});

test("the loader announces its state and uses the vector mark", () => {
  const { UniFoodLoader } = availabilityLoader()(
    "components/ui/UniFoodLoader.tsx",
  );
  const html = renderToStaticMarkup(React.createElement(UniFoodLoader, {}));
  assert.match(html, /role="status"/);
  assert.match(html, /src="\/unifood-mark\.svg"/);
  assert.match(html, /Cargando…/);
});

test("the vector mark exists and uses the brand gradient", () => {
  const svg = fs.readFileSync("public/unifood-mark.svg", "utf8");
  assert.match(svg, /viewBox="0 0 1254 1254"/);
  assert.match(svg, /#0b5fff/);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// Ola 4 · F4: the client's waits on the server show the shared spinner and aria-busy.
// Source checks: rendering the checkout mid-send needs its whole cart and clock context.

test("confirming an order shows the spinner while «Enviando pedido…»", () => {
  const source = fs.readFileSync(
    "features/client/components/ClientCheckout.tsx",
    "utf8",
  );
  assert.match(source, /import \{ Spinner \} from "@\/components\/ui\/Spinner"/);
  assert.match(source, /aria-busy=\{pending \|\| undefined\}\s*>\s*\{pending && <Spinner \/>\}/);
  assert.match(source, /"Enviando pedido…"/);
});

test("accepting the terms shows the spinner while «Un momento…»", () => {
  const source = fs.readFileSync(
    "features/client/components/TermsGate.tsx",
    "utf8",
  );
  assert.match(source, /aria-busy=\{busy \|\| undefined\}\s*>\s*\{busy && <Spinner \/>\}/);
  const css = fs.readFileSync(
    "features/client/components/TermsGate.module.css",
    "utf8",
  );
  assert.match(css, /\.primary \{\s*display: inline-flex;[^}]*gap: 8px;/);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { loadTs } from "./helpers/load-ts.mjs";

// jj/cliente-ajustes-2 · B: the password steps never look frozen.

const read = (file) => fs.readFileSync(file, "utf8");
const screen = () => read("features/auth/components/AuthScreen.tsx");
const css = () => read("features/auth/components/AuthScreen.module.css");

test("a busy step says what it does, spins and blocks a second send", () => {
  const messages = loadTs("features/shared/messages.ts");
  assert.equal(messages.AUTH_SENDING, "Enviando…");
  assert.equal(messages.AUTH_VERIFYING, "Verificando…");
  assert.equal(messages.AUTH_SAVING, "Guardando…");
  const source = screen();
  assert.match(
    source,
    /isRecovery\s*\?\s*isPassword\s*\?\s*AUTH_SAVING\s*:\s*isOtp\s*\?\s*AUTH_VERIFYING\s*:\s*AUTH_SENDING/,
  );
  assert.match(source, /disabled=\{!hydrated \|\| busy\}/);
  assert.match(source, /aria-busy=\{busy \|\| undefined\}/);
  assert.match(
    source,
    /\{busy \? \(\s*<span className=\{styles\.loginSpinner\}/,
  );
  // Announced to screen readers.
  assert.match(
    source,
    /className=\{styles\.busyStatus\}\s*role="status"\s*aria-live="polite"/,
  );
  assert.match(css(), /\.loginSpinner \{\s*width: 20px;\s*height: 20px;/);
});

test("after 3 s it says it is slow, and a lost answer frees the button", () => {
  const messages = loadTs("features/shared/messages.ts");
  assert.equal(messages.AUTH_SLOW, "Esto está tardando más de lo normal…");
  assert.equal(messages.AUTH_SLOW_MS, 3000);
  const source = screen();
  assert.match(source, /setTimeout\(\(\) => setSlow\(true\), AUTH_SLOW_MS\)/);
  assert.match(source, /\{busy \? \(slow \? AUTH_SLOW : buttonText\) : ""\}/);
  assert.match(source, /signal: AbortSignal\.timeout\(AUTH_TIMEOUT_MS\)/);
  assert.match(source, /\} catch \{\s*throw new Error\(t\.connection\);/);
});

test("steps slide in for 180 ms and stay still with reduced motion", () => {
  assert.match(screen(), /key=\{`\$\{mode\}-\$\{step\}`\}/);
  assert.match(css(), /\.stepIn \{\s*animation: step-in 180ms ease-out;/);
  assert.match(
    css(),
    /prefers-reduced-motion: reduce\) \{\s*\.stepIn \{\s*animation: none;/,
  );
});

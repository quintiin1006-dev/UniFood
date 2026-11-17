import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (file) => fs.readFileSync(file, "utf8");
const dir = "features/client-orders";
const myOrder = read(`${dir}/components/MyOrder.tsx`);
const history = read(`${dir}/components/OrderHistory.tsx`);
const css = read(`${dir}/components/ClientOrders.module.css`);
const api = read(`${dir}/api.ts`);
const sound = read(`${dir}/sound.ts`);
const hook = read(`${dir}/useCurrentOrder.ts`);

test("«Cancelar pedido» is offered only while the order is PENDING, with a destructive confirmation", () => {
  const offers = myOrder.match(/order\.status === "PENDING"/g) ?? [];
  assert.equal(offers.length, 1);
  assert.match(
    myOrder,
    /order\.status === "PENDING" && \(\s*<Button\s+variant="danger"/,
  );
  // The safe answer is the default focus and the destructive one waits with a spinner.
  assert.match(myOrder, /Mantener pedido/);
  assert.match(myOrder, /<Button variant="secondary"[^>]*autoFocus/);
  assert.match(myOrder, /loading=\{busy\}/);
  assert.match(myOrder, /Cancelando…/);
  // The error stays inside the dialog, from the central catalogue.
  assert.match(myOrder, /<Notice tone="error"/);
});

test("a notice is announced politely, the sound can be silenced and the title is restored", () => {
  assert.match(myOrder, /aria-live="polite"/);
  assert.match(myOrder, /role="switch"/);
  assert.match(myOrder, /aria-checked=\{!muted\}/);
  assert.match(
    myOrder,
    /if \(document\.title === title\) document\.title = previous/,
  );
  assert.match(myOrder, /armChime\(\)/);
  assert.match(myOrder, /if \(!mutedRef\.current\) playChime\(\)/);
});

test("sound waits for a gesture and every storage access is guarded", () => {
  assert.match(sound, /pointerdown/);
  assert.match(
    sound,
    /if \(!context \|\| context\.state === "closed"\) return false/,
  );
  for (const access of ["getItem", "setItem", "removeItem"]) {
    const at = sound.indexOf(access);
    assert.ok(at > 0, access);
    assert.match(sound.slice(Math.max(0, at - 120), at), /try \{/);
  }
});

test("the screens only talk to the BFF of the same origin", () => {
  const urls = [...api.matchAll(/fetch\(\s*[`"]([^`"]+)/g)].map((m) => m[1]);
  assert.ok(urls.length >= 4);
  for (const url of urls) assert.ok(url.startsWith("/api/me/orders"), url);
  assert.equal((api.match(/cache: "no-store"/g) ?? []).length, urls.length);
  assert.doesNotMatch(api, /NEXT_PUBLIC|authorization|Bearer/i);
  assert.match(api, /AbortSignal\.timeout/);
});

test("the history is read-only: no «repetir pedido» and no cancel", () => {
  assert.doesNotMatch(history, /repetir/i);
  assert.doesNotMatch(history, /cancelOrder|Cancelar pedido/);
  assert.match(history, /Cargar más/);
  assert.match(history, /useOrderHistory/);
});

test("the poller pauses with the tab and reads again when it returns", () => {
  assert.match(hook, /visibilitychange/);
  assert.match(hook, /document\.visibilityState !== "hidden"/);
  assert.match(hook, /poller\.stop\(\)/);
});

test("touch targets are 44 px, focus is visible and motion respects the preference", () => {
  for (const rule of ["soundSwitch", "dismiss", "historyRow"])
    assert.match(
      css,
      new RegExp(`\\.${rule} \\{[^}]*min-(height|width): 44px`),
      rule,
    );
  assert.match(css, /:focus-visible/);
  assert.match(css, /prefers-reduced-motion: no-preference/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  // The pulse of the skeleton only runs when motion is welcome.
  const animated = css.indexOf("animation: pulse");
  assert.ok(animated > css.indexOf("prefers-reduced-motion: no-preference"));
});

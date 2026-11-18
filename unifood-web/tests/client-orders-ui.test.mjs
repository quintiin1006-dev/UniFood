import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (file) => fs.readFileSync(file, "utf8");
const dir = "features/client-orders";
const myOrder = read(`${dir}/components/MyOrder.tsx`);
const board = read(`${dir}/components/OrderBoard.tsx`);
const history = read(`${dir}/components/OrderHistory.tsx`);
const messages = read("features/shared/messages.ts");
const css = read(`${dir}/components/ClientOrders.module.css`);
const api = read(`${dir}/api.ts`);
const sound = read(`${dir}/sound.ts`);
const hook = read(`${dir}/useCurrentOrder.ts`);

test("«Cancelar pedido» is offered only while the order is PENDING, with a destructive confirmation", () => {
  const offers = board.match(/order\.status === "PENDING"/g) ?? [];
  assert.equal(offers.length, 1);
  assert.match(
    board,
    /order\.status === "PENDING" && \(\s*<Button\s+variant="danger"/,
  );
  // The safe answer is the default focus and the destructive one waits with a spinner.
  assert.match(board, /CANCEL_KEEP/);
  assert.match(board, /<Button variant="secondary"[^>]*autoFocus/);
  assert.match(board, /loading=\{busy\}/);
  assert.match(messages, /CANCEL_CONFIRMING = "Cancelando…"/);
  // The error stays inside the dialog, from the central catalogue.
  assert.match(board, /<Notice tone="error"/);
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
  assert.match(history, /HISTORY_LOAD_MORE/);
  assert.match(history, /useOrderHistory/);
  assert.match(messages, /HISTORY_LOAD_MORE = "Cargar más"/);
});

test("the poller pauses with the tab and reads again when it returns", () => {
  assert.match(hook, /visibilitychange/);
  assert.match(hook, /document\.visibilityState !== "hidden"/);
  assert.match(hook, /poller\.stop\(\)/);
});

test("new texts of the module live in the catalogue, not in the components", () => {
  for (const source of [board, history]) {
    assert.doesNotMatch(
      source,
      />\s*(Mantener pedido|Sí, cancelar pedido|Cargar más|Aún no tienes)/,
    );
  }
  assert.doesNotMatch(myOrder, /No tienes un pedido activo/);
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

test("the stage board fits 360 px: five cells on one row, no horizontal scroll", () => {
  assert.match(
    css,
    /\.stages \{[^}]*grid-template-columns: repeat\(5, minmax\(0, 1fr\)\)/,
  );
  assert.doesNotMatch(css, /\.stages \{[^}]*overflow-x/);
  assert.match(css, /\.srOnly \{/);
  assert.match(board, /<Icon name=\{ORDER_STAGE_ICONS\[index\]\} size=\{20\}/);
});

test("the state is never colour alone: the current stage has aria-current and a text", () => {
  assert.match(board, /aria-current=\{isCurrent \? "step" : undefined\}/);
  assert.match(board, /stageCounter\(index \+ 1, ORDER_STAGE_COUNT\)/);
  assert.match(board, /STAGE_CURRENT/);
});

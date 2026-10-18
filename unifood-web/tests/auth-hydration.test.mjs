import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { availabilityLoader } from "./helpers/load-availability.mjs";

const AuthScreen = availabilityLoader({
  mocks: {
    "next/link": {
      __esModule: true,
      default: ({ children, ...props }) => createElement("a", props, children),
    },
    "next/image": {
      __esModule: true,
      default: ({ src, alt, sizes }) =>
        createElement("img", { src, alt, sizes, loading: "lazy" }),
    },
    "./Brand": {
      __esModule: true,
      default: () => null,
      Waves: () => null,
    },
  },
})("features/auth/components/AuthScreen.tsx").default;

function render(entrypoint, initialMode = "login") {
  return renderToString(
    createElement(AuthScreen, {
      initialMode,
      entrypoint,
      usernameDomain: "ustavillavo.edu.co",
    }),
  );
}

test("panel SSR disables every form control while preserving credential hints and remember default", () => {
  const html = render("panel");
  const controls = [...html.matchAll(/<(?:input|button)\b[^>]*>/g)].map(
    ([tag]) => tag,
  );
  assert.equal(controls.length, 5);
  assert.ok(controls.every((tag) => /\sdisabled=""/.test(tag)));
  const form = html.match(/<form\b[^>]*>/)[0];
  assert.match(form, /method="post"/);
  assert.match(form, /autoComplete="off"/i);
  assert.match(html, /<input[^>]*autoComplete="username"/i);
  assert.match(html, /<input[^>]*autoComplete="current-password"/i);
  assert.match(html, /<input[^>]*type="checkbox"[^>]*checked=""/);
  assert.match(html, /aria-busy="false"/);
});

test("CLIENT keeps its existing form autocomplete policy and SSR credential guard", () => {
  const html = render("client");
  assert.doesNotMatch(html.match(/<form\b[^>]*>/)[0], /autocomplete=/i);
  assert.match(html, /<input[^>]*disabled=""[^>]*name="username"/);
  assert.match(html, /<input[^>]*disabled=""[^>]*name="password"/);
});

test("the panel login restoration opt-out does not change recovery forms", () => {
  const html = render("panel", "recover");
  assert.doesNotMatch(html.match(/<form\b[^>]*>/)[0], /autocomplete=/i);
});

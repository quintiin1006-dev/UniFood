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

test("CLIENT login keeps credential hints and SSR guard", () => {
  const html = render("client");
  assert.match(html, /<input[^>]*autoComplete="username"/i);
  assert.match(html, /<input[^>]*autoComplete="current-password"/i);
  assert.match(html, /<input[^>]*disabled=""[^>]*name="username"/);
  assert.match(html, /<input[^>]*disabled=""[^>]*name="password"/);
});

const SCREENS = [
  ["/login", "client", "login"],
  ["/panel/login", "panel", "login"],
  ["/registro", "client", "register"],
  ["/recuperar-contrasena", "client", "recover"],
];

for (const [route, entrypoint, mode] of SCREENS) {
  test(`${route} opts out of form restoration and disables its SSR controls`, () => {
    const html = render(entrypoint, mode);
    assert.match(html.match(/<form\b[^>]*>/)[0], /autoComplete="off"/i);
    const controls = [...html.matchAll(/<(?:input|button)\b[^>]*>/g)]
      .map(([tag]) => tag)
      .filter((tag) => !/type="(?:button|hidden)"/.test(tag));
    assert.ok(controls.length > 0);
    assert.ok(controls.every((tag) => /\sdisabled=""/.test(tag)));
  });
}

test("/registro keeps its field autofill hints", () => {
  // Step 1 asks only for the email; name and password belong to step 2.
  const html = render("client", "register");
  assert.match(html, /<input[^>]*autoComplete="email"/i);
  assert.doesNotMatch(html, /autoComplete="(?:name|new-password)"/i);
});

const CompleteRegistration = availabilityLoader({
  mocks: {
    "next/link": {
      __esModule: true,
      default: ({ children, ...props }) => createElement("a", props, children),
    },
    "./Brand": {
      __esModule: true,
      default: () => null,
      Waves: () => null,
    },
  },
})("features/auth/components/CompleteRegistration.tsx").default;

test("/registro/completar disables its SSR controls and keeps autofill hints", () => {
  const html = renderToString(
    createElement(CompleteRegistration, {
      rules: {
        emailConfirmed: true,
        clientType: "STUDENT",
        codeRequired: true,
        minCodeLength: 7,
        maxCodeLength: 7,
      },
    }),
  );
  const form = html.match(/<form\b[^>]*>/)[0];
  assert.match(form, /method="post"/);
  assert.match(form, /autoComplete="off"/i);
  const controls = [...html.matchAll(/<(?:input|button)\b[^>]*>/g)]
    .map(([tag]) => tag)
    .filter((tag) => !/type="(?:button|hidden)"/.test(tag));
  assert.ok(controls.length > 0);
  assert.ok(controls.every((tag) => /\sdisabled=""/.test(tag)));
  assert.match(html, /<input[^>]*autoComplete="name"/i);
  assert.match(html, /<input[^>]*autoComplete="new-password"/i);
  // Length comes from the server's rules, never from the client.
  assert.match(html, /<input[^>]*maxLength="7"[^>]*name="institutional-code"/i);
  assert.match(html, /href="\/privacidad"/);
  assert.match(html, /Solo números, 7 dígitos\./);
});

for (const mode of ["register", "recover"]) {
  test(`${mode} back button outside the form opts out of restoration itself`, () => {
    const html = render("client", mode);
    const form = html.match(/<form\b[^>]*>/)[0];
    const back = html.slice(0, html.indexOf(form)).match(/<button\b[^>]*>/)[0];
    assert.match(back, /type="button"/);
    assert.match(back, /autoComplete="off"/i);
    assert.match(back, /\sdisabled=""/);
  });
}

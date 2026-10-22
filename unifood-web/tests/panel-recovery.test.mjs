import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { availabilityLoader } from "./helpers/load-availability.mjs";

const load = availabilityLoader();
const { PanelRecoveryFlow } = load("features/panel-recovery/flow.ts");
const { publicRecoveryConfig } = load("features/panel-recovery/config.ts");
const { RECOVERY_MESSAGES } = load("features/panel-recovery/errors.ts");
function fixture() {
  const calls = [];
  let listener = () => {};
  const state = {
    error: null,
    identityError: null,
    user: "verified-user",
    event: "PASSWORD_RECOVERY",
    cleanupError: false,
    updateError: null,
  };
  const auth = {
    resetPasswordForEmail: async (email, options) => {
      calls.push(["recover", email, options]);
      return { error: state.error };
    },
    onAuthStateChange: (callback) => {
      listener = callback;
      return { data: { subscription: { unsubscribe() {} } } };
    },
    exchangeCodeForSession: async (code) => {
      calls.push(["exchange", code]);
      if (!state.error)
        listener(state.event, { user: { id: "verified-user" } });
      return {
        data: {
          session: { user: { id: "verified-user" } },
          user: { id: "verified-user" },
        },
        error: state.error,
      };
    },
    getUser: async () => {
      calls.push(["identity"]);
      return { data: { user: { id: state.user } }, error: state.identityError };
    },
    updateUser: async (input) => {
      calls.push(["update", Object.keys(input)]);
      return { error: state.updateError };
    },
    signOut: async (options) => {
      calls.push(["signOut", options]);
      return { error: null };
    },
  };
  const flow = new PanelRecoveryFlow(
    () => auth,
    async () => {
      calls.push(["panelLogout"]);
      if (state.cleanupError) throw new Error("PRIVATE");
    },
  );
  return { calls, state, flow, auth };
}

test("only public publishable or anon credentials can cross the browser boundary", () => {
  const url = "https://auth.example.invalid";
  assert.deepEqual(publicRecoveryConfig({ url, key: "sb_publishable_test" }), {
    url,
    key: "sb_publishable_test",
  });
  const key = (role) =>
    `e30.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.signature`;
  assert.ok(publicRecoveryConfig({ url, key: key("anon") }));
  for (const value of [
    null,
    "sb_secret_PRIVATE",
    key("service_role"),
    "opaque-unknown",
  ])
    assert.equal(
      publicRecoveryConfig(value ? { url, key: value } : null),
      null,
    );
});

test("empty and invalid emails cannot reach Auth", async () => {
  const { flow, calls } = fixture();
  for (const email of ["", " ", "invalid", "a@@invalid.test"])
    await assert.rejects(
      flow.request(email, "http://localhost:3000"),
      (error) => error.kind === "email",
    );
  assert.equal(calls.length, 0);
});

test("valid recovery calls only Supabase Auth with the implemented redirect and no role admission", async () => {
  const { flow, calls } = fixture();
  await flow.request(" WORKER@EXAMPLE.INVALID ", "http://localhost:3000");
  assert.deepEqual(calls, [
    [
      "recover",
      "worker@example.invalid",
      { redirectTo: "http://localhost:3000/panel/nueva-contrasena" },
    ],
  ]);
});

test("account-specific rejections share the neutral result without exposing provider details", async () => {
  for (const error of [
    null,
    { status: 400, code: "user_not_found" },
    { status: 422, code: "email_address_not_authorized" },
  ]) {
    const { flow, state } = fixture();
    state.error = error;
    assert.equal(
      await flow.request("someone@example.invalid", "http://localhost:3000"),
      undefined,
    );
  }
  assert.ok(RECOVERY_MESSAGES.neutral.startsWith("Si existe una cuenta"));
});

test("rate limit and transient request failures are sanitized", async () => {
  for (const [error, kind] of [
    [{ status: 429, message: "PRIVATE" }, "rate"],
    [{ status: 503, message: "PRIVATE" }, "temporary"],
  ]) {
    const { flow, state } = fixture();
    state.error = error;
    await assert.rejects(
      flow.request("someone@example.invalid", "http://localhost:3000"),
      (failure) =>
        failure.kind === kind && !failure.message.includes("PRIVATE"),
    );
  }
});

test("email, arbitrary URL code or ordinary SIGNED_IN cannot authorize update", async () => {
  const { flow, state, calls } = fixture();
  await assert.rejects(
    flow.update("SyntheticValue8"),
    (error) => error.kind === "invalid",
  );
  for (const code of [null, "", "email@example.invalid", "short"])
    await assert.rejects(
      flow.verify(code),
      (error) => error.kind === "invalid",
    );
  state.event = "SIGNED_IN";
  await assert.rejects(
    flow.verify("valid-but-not-recovery-code"),
    (error) => error.kind === "invalid",
  );
  assert.equal(
    calls.some(([name]) => name === "update"),
    false,
  );
});

test("expired/used Supabase proof never enables password update", async () => {
  const { flow, state } = fixture();
  state.error = { status: 403, code: "otp_expired", message: "PRIVATE" };
  await assert.rejects(
    flow.verify("expired-code-value"),
    (error) => error.kind === "invalid" && !error.message.includes("PRIVATE"),
  );
  await assert.rejects(
    flow.update("SyntheticValue8"),
    (error) => error.kind === "invalid",
  );
});

test("valid proof and verified identity are required both before and during update", async () => {
  const { flow, state, calls } = fixture();
  await flow.verify("valid-recovery-code");
  state.user = "foreign-user";
  await assert.rejects(
    flow.update("SyntheticValue8"),
    (error) => error.kind === "invalid",
  );
  assert.equal(
    calls.some(([name]) => name === "update"),
    false,
  );
});

test("successful password update is one-use, followed by provider logout and existing panel cleanup", async () => {
  const { flow, calls } = fixture();
  await flow.verify("valid-recovery-code");
  await flow.update("SyntheticValue8");
  await assert.rejects(
    flow.update("SyntheticValue8"),
    (error) => error.kind === "invalid",
  );
  await flow.finish();
  assert.deepEqual(calls.slice(-3), [
    ["update", ["password"]],
    ["signOut", { scope: "global" }],
    ["panelLogout"],
  ]);
  assert.equal(JSON.stringify(calls).includes("SyntheticValue8"), false);
});

test("temporary update is retryable and finishing failure never resubmits the password", async () => {
  const { flow, state, calls } = fixture();
  await flow.verify("valid-recovery-code");
  state.updateError = { status: 503, message: "PRIVATE" };
  await assert.rejects(
    flow.update("SyntheticValue8"),
    (error) => error.kind === "temporary",
  );
  state.updateError = null;
  await flow.update("SyntheticValue8");
  const updates = calls.filter(([name]) => name === "update").length;
  state.cleanupError = true;
  await assert.rejects(flow.finish(), (error) => error.kind === "temporary");
  state.cleanupError = false;
  await flow.finish();
  assert.equal(calls.filter(([name]) => name === "update").length, updates);
});

test("weak/same-password provider failures are safe and finish cannot precede update", async () => {
  const { flow, state } = fixture();
  await assert.rejects(flow.finish(), (error) => error.kind === "invalid");
  await flow.verify("valid-recovery-code");
  for (const [code, kind] of [
    ["weak_password", "weak"],
    ["same_password", "same"],
  ]) {
    state.updateError = { status: 422, code, message: "PRIVATE" };
    await assert.rejects(
      flow.update("SyntheticValue8"),
      (error) => error.kind === kind && !error.message.includes("PRIVATE"),
    );
  }
});

function screen(mode) {
  const modules = availabilityLoader({
    mocks: {
      "next/link": {
        __esModule: true,
        default: ({ children, ...props }) =>
          createElement("a", props, children),
      },
      "next/image": {
        __esModule: true,
        default: ({ src, alt }) => createElement("img", { src, alt }),
      },
    },
  });
  const Component = modules(
    "features/panel-recovery/PanelRecoveryScreen.tsx",
  ).PanelRecoveryScreen;
  return renderToString(createElement(Component, { mode, config: null }));
}

test("request SSR shows modern shared hero, exact copy and deterministically disabled email/submit", () => {
  const html = screen("request");
  assert.match(html, /Recupera tu cuenta/);
  assert.match(html, /Enviar instrucciones/);
  assert.match(html, /\/images\/client\/Topos.png/);
  assert.doesNotMatch(html, /panel-cafeteria|Enviar código/);
  assert.match(html.match(/<form[^>]*>/)[0], /autoComplete="off"/i);
  const controls = [...html.matchAll(/<(input|button)\b[^>]*>/g)].map(
    ([tag]) => tag,
  );
  assert.ok(controls.every((tag) => /disabled=""/.test(tag)));
});

test("password SSR starts by validating proof and never exposes an enabled password form", () => {
  const html = screen("password");
  assert.match(html, /Crea una nueva contraseña/);
  assert.match(html, /role="status"/);
  assert.doesNotMatch(html, /<input|<form/);
});

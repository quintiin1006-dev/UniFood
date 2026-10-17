import { test } from "node:test";
import assert from "node:assert/strict";
import { availabilityLoader } from "./helpers/load-availability.mjs";

const user = {
  id: "verified-subject",
  email: "auth@example.invalid",
  email_confirmed_at: "2026-01-01",
};
function fixture(options = {}) {
  const calls = [],
    persisted = [];
  const load = availabilityLoader({
    mocks: {
      react: { cache: (fn) => fn },
      "./config": { authConfig: () => (options.config === false ? null : {}) },
      "./client": {
        authClient: async (_remember, _written, defer) => ({
          auth: {
            async getUser() {
              calls.push("getUser");
              defer(() => persisted.push("SDK-cookie-write"));
              if (options.throwUser) throw options.throwUser;
              return {
                data: {
                  user: Object.hasOwn(options, "user") ? options.user : user,
                },
                error: options.userError,
              };
            },
            async getSession() {
              calls.push("getSession");
              return {
                data: {
                  session: Object.hasOwn(options, "session")
                    ? options.session
                    : {
                        user: {
                          id: user.id,
                          email: "untrusted@cookie.invalid",
                        },
                        access_token: "verified-bearer",
                      },
                },
                error: options.sessionError,
              };
            },
          },
          rpc() {
            assert.fail("Identity must not apply business admission");
          },
        }),
      },
    },
  });
  return {
    get: load("features/auth/server/identity.ts").getVerifiedAuthIdentity,
    calls,
    persisted,
  };
}
test("verified identity keeps provider email, reads bearer only after getUser and applies no business policy", async () => {
  const f = fixture();
  assert.deepEqual(await f.get(), {
    id: user.id,
    email: user.email,
    accessToken: "verified-bearer",
  });
  assert.deepEqual(f.calls, ["getUser", "getSession"]);
  assert.deepEqual(f.persisted, ["SDK-cookie-write"]);
});
test("missing/invalid/unconfirmed identities cannot read a bearer", async () => {
  for (const options of [
    { config: false },
    { user: null },
    { userError: { status: 401 } },
    { user: { ...user, email_confirmed_at: null } },
  ]) {
    const f = fixture(options);
    assert.equal(await f.get(), null);
    assert.ok(!f.calls.includes("getSession"));
  }
});
test("a missing session, wrong session subject or empty bearer cannot supply an identity", async () => {
  for (const session of [
    null,
    { user: { id: "other-subject" }, access_token: "forged" },
    { user: { id: user.id }, access_token: "" },
  ])
    assert.equal(await fixture({ session }).get(), null);
});
test("temporary provider/session failures discard even queued SDK deletions, then recover", async () => {
  for (const options of [
    { userError: { status: 503 } },
    { sessionError: { status: 503 } },
    { throwUser: new TypeError("PRIVATE") },
    { throwUser: new DOMException("PRIVATE", "TimeoutError") },
  ]) {
    const f = fixture(options);
    await assert.rejects(
      f.get(),
      (e) =>
        e.code === "AUTH_TEMPORARILY_UNAVAILABLE" &&
        !e.message.includes("PRIVATE"),
    );
    assert.deepEqual(f.persisted, []);
  }
  assert.equal((await fixture().get()).email, user.email);
});
test("Next rendering signals remain framework signals", async () => {
  const signal = Object.assign(new Error("dynamic"), {
    digest: "DYNAMIC_SERVER_USAGE",
  });
  const f = fixture({ throwUser: signal });
  await assert.rejects(f.get(), (e) => e === signal);
  assert.deepEqual(f.persisted, []);
});

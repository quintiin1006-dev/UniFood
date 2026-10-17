import { test } from "node:test";
import assert from "node:assert/strict";
import { availabilityLoader } from "./helpers/load-availability.mjs";
function fixture() {
  let sdk;
  const written = [];
  const load = availabilityLoader({
    mocks: {
      "@supabase/ssr": {
        createServerClient(_url, _key, config) {
          sdk = config;
          return { marker: "same-sdk-contract" };
        },
      },
      "next/headers": {
        cookies: async () => ({
          get: () => undefined,
          getAll: () => [],
          set: (...args) => written.push(args),
        }),
      },
      "./config": {
        authConfig: () => ({
          url: "http://provider.invalid",
          key: "public-test",
        }),
        authCookieName: () => "auth-token",
        rememberCookie: "remember",
        sessionCookieOptions: (persistent, deleting) => ({
          persistent,
          deleting,
        }),
      },
    },
  });
  return {
    client: load("features/auth/server/client.ts").authClient,
    sdk: () => sdk,
    written,
  };
}
test("existing authClient callers keep immediate cookie writes, deletion semantics and SDK return contract", async () => {
  const f = fixture(),
    names = [];
  assert.deepEqual(await f.client(true, (value) => names.push(...value)), {
    marker: "same-sdk-contract",
  });
  f.sdk().cookies.setAll([
    { name: "auth-token", value: "", options: { maxAge: 0 } },
  ]);
  assert.deepEqual(names, ["auth-token"]);
  assert.deepEqual(f.written, [
    ["auth-token", "", { persistent: true, deleting: true }],
  ]);
});
test("only the new opt-in identity caller defers SDK writes and can discard them", async () => {
  const f = fixture(),
    queue = [];
  await f.client(undefined, undefined, (write) => queue.push(write));
  f.sdk().cookies.setAll([
    { name: "auth-token", value: "refreshed", options: { maxAge: 3600 } },
  ]);
  assert.deepEqual(f.written, []);
  assert.equal(queue.length, 1);
  queue[0]();
  assert.deepEqual(f.written, [
    ["auth-token", "refreshed", { persistent: false, deleting: false }],
  ]);
});

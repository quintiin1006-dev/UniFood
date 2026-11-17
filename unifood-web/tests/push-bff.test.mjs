import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { availabilityLoader } from "./helpers/load-availability.mjs";

const backend = "http://backend.test:8080";
const ORIGIN = "http://localhost:3400";
const SUBSCRIPTION_ID = "6f1c2b9e-4b8f-4c55-9a7e-2d3f4a5b6c7d";
const ENDPOINT = "https://fcm.googleapis.com/fcm/send/device-secret";
const P256DH = "B" + "A".repeat(86);
const AUTH = "A".repeat(22);

function jar() {
  const values = new Map();
  return {
    values,
    get: (name) =>
      values.has(name) ? { name, value: values.get(name) } : undefined,
    set: (name, value, options) =>
      values.set(name, value) && (values.options = options),
    delete: (name) => values.delete(name),
  };
}

function profile(roles) {
  return {
    id: "user-1",
    email: "ana@ustavillavo.edu.co",
    roles,
    active: true,
    cafeteriaIds: roles.includes("WORKER") ? ["cafe-1"] : [],
  };
}

function setup({ roles = ["CLIENT"], auth = true, upstream } = {}) {
  const cookies = jar();
  const calls = [];
  const fetchMock = async (url, init) => {
    calls.push({ url, init });
    return upstream ? upstream(url, init) : new Response(null, { status: 500 });
  };
  const load = availabilityLoader({
    fetchMock,
    mocks: {
      "next/headers": { cookies: async () => cookies },
      "@/config/server": { serverApiUrl: () => backend },
      "@/features/auth/server/session": {
        getAuth: async () =>
          auth
            ? { profile: profile(roles), accessToken: "verified-token" }
            : null,
      },
    },
  });
  return {
    forward: load("features/push/server/forward.ts"),
    cookies,
    calls,
    load,
  };
}

function request(method, body, { origin = ORIGIN } = {}) {
  const headers = {
    host: "localhost:3400",
    "content-type": "application/json",
  };
  if (origin) headers.origin = origin;
  return new Request(`${ORIGIN}/api/me/push/subscribe`, {
    method,
    headers,
    body:
      body === undefined
        ? undefined
        : typeof body === "string"
          ? body
          : JSON.stringify(body),
  });
}

const subscription = (extra = {}) => ({
  endpoint: ENDPOINT,
  keys: { p256dh: P256DH, auth: AUTH },
  ...extra,
});

test("subscribe forwards only the subscription, with the session bearer and safe fetch options", async () => {
  const { forward, cookies, calls } = setup({
    upstream: () => Response.json({ subscriptionId: SUBSCRIPTION_ID }),
  });
  const response = await forward.forwardSubscribe(
    request(
      "POST",
      subscription({ userId: "victim", role: "WORKER", userAgent: "Mozilla" }),
    ),
    "client",
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { subscribed: true });
  assert.equal(calls.length, 1);
  const [{ url, init }] = calls;
  assert.equal(url, `${backend}/api/me/push/subscribe`);
  assert.equal(init.method, "POST");
  assert.equal(init.cache, "no-store");
  assert.equal(init.redirect, "error");
  assert.ok(init.signal instanceof AbortSignal);
  assert.equal(init.headers.authorization, "Bearer verified-token");
  assert.deepEqual(JSON.parse(init.body), {
    endpoint: ENDPOINT,
    keys: { p256dh: P256DH, auth: AUTH },
    userAgent: "Mozilla",
  });
  // The id is kept server-side for sign-out, never exposed to page scripts.
  assert.equal(
    cookies.values.get("unifood-push-subscription"),
    SUBSCRIPTION_ID,
  );
  assert.equal(cookies.values.options.httpOnly, true);
  assert.equal(cookies.values.options.sameSite, "strict");
});

test("the worker route goes to the worker endpoint and admits only workers", async () => {
  const worker = setup({
    roles: ["WORKER"],
    upstream: () => Response.json({ subscriptionId: SUBSCRIPTION_ID }),
  });
  assert.equal(
    (
      await worker.forward.forwardSubscribe(
        request("POST", subscription()),
        "worker",
      )
    ).status,
    200,
  );
  assert.equal(worker.calls[0].url, `${backend}/api/worker/push/subscribe`);

  const client = setup({ roles: ["CLIENT"] });
  const denied = await client.forward.forwardSubscribe(
    request("POST", subscription()),
    "worker",
  );
  assert.equal(denied.status, 403);
  assert.equal(client.calls.length, 0);

  const worker2 = setup({ roles: ["WORKER"] });
  assert.equal(
    (
      await worker2.forward.forwardSubscribe(
        request("POST", subscription()),
        "client",
      )
    ).status,
    403,
  );
});

test("cross-origin, signed-out and malformed requests never reach Spring", async () => {
  const { forward, calls } = setup();
  assert.equal(
    (
      await forward.forwardSubscribe(
        request("POST", subscription(), { origin: "https://evil.example" }),
        "client",
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await forward.forwardSubscribe(
        request("POST", subscription(), { origin: null }),
        "client",
      )
    ).status,
    403,
  );
  const signedOut = setup({ auth: false });
  assert.equal(
    (
      await signedOut.forward.forwardSubscribe(
        request("POST", subscription()),
        "client",
      )
    ).status,
    401,
  );
  for (const bad of [
    "not json",
    {},
    subscription({ endpoint: "http://fcm.googleapis.com/x" }),
    subscription({ endpoint: "https://user:pw@fcm.googleapis.com/x" }),
    subscription({
      endpoint: "https://fcm.googleapis.com/" + "x".repeat(2100),
    }),
    { endpoint: ENDPOINT, keys: { p256dh: "short", auth: AUTH } },
    { endpoint: ENDPOINT, keys: { p256dh: P256DH, auth: "bad auth!" } },
    "x".repeat(5000),
  ]) {
    const response = await forward.forwardSubscribe(
      request("POST", bad),
      "client",
    );
    assert.equal(response.status, 400, JSON.stringify(bad).slice(0, 60));
    assert.equal((await response.json()).code, "PUSH_SUBSCRIPTION_INVALID");
  }
  assert.equal(calls.length, 0);
});

test("Spring errors are mapped to fixed messages without relaying their body", async () => {
  const cases = [
    [400, null, "PUSH_SUBSCRIPTION_INVALID", 400],
    [403, null, "FORBIDDEN", 403],
    [429, "60", "PUSH_RATE_LIMITED", 429],
    [500, null, "PUSH_UNAVAILABLE", 502],
  ];
  for (const [status, retry, code, mapped] of cases) {
    const { forward } = setup({
      upstream: () =>
        new Response(
          JSON.stringify({
            code: "LEAK",
            message: "stack trace with endpoint",
          }),
          {
            status,
            headers: retry ? { "Retry-After": retry } : {},
          },
        ),
    });
    const response = await forward.forwardSubscribe(
      request("POST", subscription()),
      "client",
    );
    assert.equal(response.status, mapped);
    const body = await response.json();
    assert.equal(body.code, code);
    assert.doesNotMatch(JSON.stringify(body), /stack trace|LEAK/);
    if (status === 429) assert.equal(response.headers.get("retry-after"), "60");
  }
  const disabled = setup({
    upstream: () => Response.json({ code: "PUSH_DISABLED" }, { status: 503 }),
  });
  const key = await disabled.forward.forwardPublicKey("client");
  assert.equal(key.status, 503);
  assert.equal((await key.json()).code, "PUSH_DISABLED");
  const down = setup({
    upstream: () => {
      throw new TypeError("fetch failed");
    },
  });
  assert.equal(
    (
      await down.forward.forwardSubscribe(
        request("POST", subscription()),
        "client",
      )
    ).status,
    503,
  );
});

test("the public key is validated before reaching the browser", async () => {
  const key = "B" + "x".repeat(86);
  const ok = setup({
    upstream: () => Response.json({ publicKey: key, extra: "dropped" }),
  });
  const response = await ok.forward.forwardPublicKey("client");
  assert.deepEqual(await response.json(), { publicKey: key });
  assert.equal(ok.calls[0].init.method, "GET");
  const bad = setup({
    upstream: () => Response.json({ publicKey: "<script>" }),
  });
  assert.equal((await bad.forward.forwardPublicKey("client")).status, 502);
});

test("unsubscribe sends only this browser's endpoint and clears the sign-out cookie", async () => {
  const { forward, calls, cookies } = setup({
    upstream: () => new Response(null, { status: 204 }),
  });
  cookies.values.set("unifood-push-subscription", SUBSCRIPTION_ID);
  const response = await forward.forwardUnsubscribe(
    request("DELETE", { endpoint: ENDPOINT, subscriptionId: "someone-elses" }),
    "client",
  );
  assert.equal(response.status, 204);
  assert.equal(calls[0].init.method, "DELETE");
  assert.deepEqual(JSON.parse(calls[0].init.body), { endpoint: ENDPOINT });
  assert.equal(cookies.values.has("unifood-push-subscription"), false);
});

test("sign-out revokes the cookie's subscription with the ending session, bounded and silent", async () => {
  const { load, cookies, calls } = setup({
    upstream: () => new Response(null, { status: 204 }),
  });
  const { revokePushOnSignOut } = load("features/push/server/signOut.ts");
  cookies.values.set("unifood-push-subscription", SUBSCRIPTION_ID);
  await revokePushOnSignOut("ending-session-token");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${backend}/api/me/push/subscribe`);
  assert.equal(calls[0].init.method, "DELETE");
  assert.equal(calls[0].init.redirect, "error");
  assert.equal(
    calls[0].init.headers.authorization,
    "Bearer ending-session-token",
  );
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    subscriptionId: SUBSCRIPTION_ID,
  });
  assert.equal(cookies.values.has("unifood-push-subscription"), false);

  // No cookie: nothing to revoke. A forged cookie is dropped without a request.
  await revokePushOnSignOut("token");
  cookies.values.set("unifood-push-subscription", "../../admin");
  await revokePushOnSignOut("token");
  assert.equal(calls.length, 1);
  assert.equal(cookies.values.has("unifood-push-subscription"), false);

  // Spring unreachable: sign-out still completes.
  const failing = setup({
    upstream: () => {
      throw new TypeError("fetch failed");
    },
  });
  const signOut = failing.load("features/push/server/signOut.ts");
  failing.cookies.values.set("unifood-push-subscription", SUBSCRIPTION_ID);
  await assert.doesNotReject(signOut.revokePushOnSignOut("token"));
});

test("the logout route revokes push before ending the session, and the page drops it first", () => {
  const route = fs.readFileSync("app/api/auth/[action]/route.ts", "utf8");
  const branch = route.slice(route.indexOf('if (action === "logout")'));
  assert.ok(branch.indexOf("revokePushOnSignOut") >= 0);
  assert.ok(
    branch.indexOf("revokePushOnSignOut") <
      branch.indexOf('signOut({ scope: "local" })'),
  );
  const button = fs.readFileSync(
    "features/auth/components/LogoutButton.tsx",
    "utf8",
  );
  assert.ok(
    button.indexOf("dropPushBeforeSignOut") <
      button.indexOf('fetch("/api/auth/logout"'),
  );
});

test("the client sign-out helper never blocks sign-out", async () => {
  const removed = [];
  const previous = {
    window: globalThis.window,
    navigator: globalThis.navigator,
  };
  const storage = new Map([["unifood.push.enabled", "1"]]);
  globalThis.window = {
    localStorage: { removeItem: (key) => storage.delete(key) },
  };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      serviceWorker: {
        getRegistration: async () => ({
          pushManager: {
            getSubscription: async () => ({
              endpoint: ENDPOINT,
              unsubscribe: async () => removed.push("browser"),
            }),
          },
        }),
      },
    },
  });
  try {
    const load = availabilityLoader({
      fetchMock: async () => {
        throw new TypeError("offline");
      },
    });
    const { dropPushBeforeSignOut } = load("features/push/signOut.ts");
    await assert.doesNotReject(dropPushBeforeSignOut("client"));
    assert.deepEqual(removed, ["browser"]);
    assert.equal(storage.has("unifood.push.enabled"), false);
  } finally {
    globalThis.window = previous.window;
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: previous.navigator,
    });
  }
});

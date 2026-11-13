import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";

// The proxy with the real @supabase/ssr and auth-js: getClaims verifies real ES256 signatures
// against a JWKS served by a fake fetch, so no Auth server or database is contacted.
const require = createRequire(import.meta.url);
const { NextRequest } = require("next/server");

function load(file, mocks, cache = new Map()) {
  const resolved = path.resolve(file);
  if (cache.has(resolved)) return cache.get(resolved).exports;
  const mod = { exports: {} };
  cache.set(resolved, mod);
  const source = ts.transpileModule(fs.readFileSync(resolved, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  new Function("require", "module", "exports", source)(
    (name) => {
      if (name === "server-only") return {};
      if (name in mocks) return mocks[name];
      if (name.startsWith("@/"))
        return load(name.slice(2) + ".ts", mocks, cache);
      if (name.startsWith("."))
        return load(
          path.resolve(path.dirname(resolved), name) + ".ts",
          mocks,
          cache,
        );
      return require(name);
    },
    mod,
    mod.exports,
  );
  return mod.exports;
}

// Each test file run gets its own project host, so the SDK's per-process JWKS cache starts empty.
const host = `claims-${process.pid}-${Date.now()}`;
const config = { url: `https://${host}.invalid`, key: "opaque-test-key" };
const cookieName = `sb-${host}-auth-token`;
const userId = "00000000-0000-0000-0000-0000000000aa";
const kid = "test-signing-key";

const algorithm = { name: "ECDSA", namedCurve: "P-256" };
const signing = await crypto.subtle.generateKey(algorithm, true, [
  "sign",
  "verify",
]);
const impostor = await crypto.subtle.generateKey(algorithm, true, [
  "sign",
  "verify",
]);
const publicJwk = {
  ...(await crypto.subtle.exportKey("jwk", signing.publicKey)),
  kid,
  alg: "ES256",
  use: "sig",
};

const b64url = (value) =>
  Buffer.from(
    typeof value === "string" ? value : JSON.stringify(value),
  ).toString("base64url");

async function jwt(payload, key = signing.privateKey, header = {}) {
  const head = b64url({ alg: "ES256", typ: "JWT", kid, ...header });
  const body = b64url(payload);
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(`${head}.${body}`),
  );
  return `${head}.${body}.${Buffer.from(signature).toString("base64url")}`;
}

function claims(expiresIn = 3600, sub = userId) {
  const now = Math.floor(Date.now() / 1000);
  return {
    sub,
    aud: "authenticated",
    role: "authenticated",
    email: "worker@example.invalid",
    session_id: "00000000-0000-0000-0000-0000000000bb",
    iat: now - 60,
    exp: now + expiresIn,
  };
}

function session(token, expiresIn = 3600) {
  return {
    access_token: token,
    token_type: "bearer",
    expires_in: Math.max(expiresIn, 0),
    expires_at: Math.floor(Date.now() / 1000) + expiresIn,
    refresh_token: "refresh-token-fixture",
    user: {
      id: userId,
      aud: "authenticated",
      role: "authenticated",
      email: "worker@example.invalid",
      email_confirmed_at: "2026-11-01T00:00:00Z",
      app_metadata: {},
      user_metadata: {},
      created_at: "2026-11-01T00:00:00Z",
    },
  };
}

const cookieFor = (value) =>
  `${cookieName}=base64-${Buffer.from(JSON.stringify(value)).toString("base64url")}; unifood-remember=1`;

/** Installs a fake fetch for the Auth endpoints and returns what was requested. */
function auth({ refresh } = {}) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    calls.push(url.pathname + url.search);
    assert.equal(url.host, `${host}.invalid`, "only the configured project");
    if (url.pathname === "/auth/v1/.well-known/jwks.json")
      return Response.json({ keys: [publicJwk] });
    if (url.pathname === "/auth/v1/token" && refresh) return refresh(init);
    if (url.pathname === "/auth/v1/user")
      return Response.json(
        { code: 403, error_code: "bad_jwt", msg: "invalid JWT" },
        { status: 403 },
      );
    return Response.json(
      { error_code: "unexpected", msg: url.pathname },
      { status: 404 },
    );
  };
  return {
    calls,
    restore() {
      globalThis.fetch = original;
    },
  };
}

function proxy() {
  return load("proxy.ts", {
    "@/config/server": { serverAuthConfig: () => config },
  }).proxy;
}

const request = (pathname, cookie) =>
  new NextRequest(`http://localhost:3100${pathname}`, {
    headers: cookie ? { cookie } : {},
  });

function clearsSession(response) {
  assert.equal(response.cookies.get(cookieName)?.maxAge, 0);
  assert.equal(response.cookies.get("unifood-remember")?.maxAge, 0);
}

test("a valid token passes without asking Auth, and the JWKS is cached across requests", async () => {
  const fake = auth();
  try {
    const cookie = cookieFor(session(await jwt(claims())));
    const run = proxy();
    for (const pathname of ["/worker", "/api/orders", "/cuenta"]) {
      const response = await run(request(pathname, cookie));
      assert.equal(response.status, 200, pathname);
      assert.equal(response.headers.get("location"), null);
      assert.equal(response.cookies.get(cookieName), undefined);
    }
    // One JWKS download for the three requests and no /user round trip at all.
    assert.deepEqual(fake.calls, ["/auth/v1/.well-known/jwks.json"]);
  } finally {
    fake.restore();
  }
});

test("an absent session is denied exactly as before", async () => {
  const fake = auth();
  try {
    const run = proxy();
    const page = await run(request("/worker"));
    assert.equal(page.status, 307);
    assert.equal(
      page.headers.get("location"),
      "http://localhost:3100/panel/login",
    );
    const api = await run(request("/api/orders"));
    assert.equal(api.status, 401);
    assert.equal((await api.json()).code, "UNAUTHORIZED");
    assert.equal((await run(request("/login"))).status, 200);
    assert.deepEqual(fake.calls, []);
  } finally {
    fake.restore();
  }
});

for (const [label, forge] of [
  ["signed by another key", () => jwt(claims(), impostor.privateKey)],
  [
    "with a rewritten subject",
    async () => {
      const [head, , signature] = (await jwt(claims())).split(".");
      return `${head}.${b64url(claims(3600, "00000000-0000-0000-0000-0000000000ff"))}.${signature}`;
    },
  ],
  [
    "with a symmetric algorithm",
    () => jwt(claims(), signing.privateKey, { alg: "HS256" }),
  ],
  ["that is not a JWT", async () => "not-a-jwt"],
]) {
  test(`a token ${label} is a definitive rejection that clears the session`, async () => {
    const fake = auth();
    try {
      const cookie = cookieFor(session(await forge()));
      const run = proxy();
      const page = await run(request("/worker", cookie));
      assert.equal(page.status, 307);
      assert.equal(
        page.headers.get("location"),
        "http://localhost:3100/panel/login",
      );
      clearsSession(page);
      const api = await run(request("/api/orders", cookie));
      assert.equal(api.status, 401);
      clearsSession(api);
      const client = await run(request("/cuenta", cookie));
      assert.equal(
        client.headers.get("location"),
        "http://localhost:3100/login",
      );
    } finally {
      fake.restore();
    }
  });
}

test("an expired token whose refresh is rejected clears the session and redirects", async () => {
  const fake = auth({
    refresh: () =>
      Response.json(
        { code: 400, error_code: "refresh_token_not_found", msg: "gone" },
        { status: 400 },
      ),
  });
  try {
    const cookie = cookieFor(session(await jwt(claims(-120)), -120));
    const response = await proxy()(request("/worker", cookie));
    assert.equal(response.status, 307);
    assert.equal(
      response.headers.get("location"),
      "http://localhost:3100/panel/login",
    );
    clearsSession(response);
    assert.ok(fake.calls.some((call) => call.startsWith("/auth/v1/token")));
  } finally {
    fake.restore();
  }
});

test("an expired token is still renewed and the new session is written to the response", async () => {
  const renewed = await jwt(claims());
  const fake = auth({ refresh: () => Response.json(session(renewed)) });
  try {
    const cookie = cookieFor(session(await jwt(claims(-120)), -120));
    const response = await proxy()(request("/worker", cookie));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("location"), null);
    const written = response.cookies.get(cookieName);
    assert.ok(written?.value, "the refreshed session cookie is written");
    assert.equal(written.httpOnly, true);
    // remember=1 keeps the 30-day persistent cookie, as before.
    assert.equal(written.maxAge, 2592000);
    const stored = JSON.parse(
      Buffer.from(
        written.value.replace(/^base64-/, ""),
        "base64url",
      ).toString(),
    );
    assert.equal(stored.access_token, renewed);
    assert.ok(!fake.calls.includes("/auth/v1/user"));
  } finally {
    fake.restore();
  }
});

test("a JWKS outage is temporary: 503 without touching cookies", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new TypeError("PRIVATE_NETWORK_DETAIL");
  };
  try {
    // A fresh host, so the cached JWKS of the other tests cannot answer.
    const other = `claims-outage-${process.pid}-${Date.now()}`;
    const run = load("proxy.ts", {
      "@/config/server": {
        serverAuthConfig: () => ({
          url: `https://${other}.invalid`,
          key: "opaque-test-key",
        }),
      },
    }).proxy;
    const cookie = `sb-${other}-auth-token=base64-${Buffer.from(
      JSON.stringify(session(await jwt(claims()))),
    ).toString("base64url")}`;
    for (const pathname of ["/worker", "/api/orders"]) {
      const response = await run(request(pathname, cookie));
      assert.equal(response.status, 503, pathname);
      assert.equal(response.headers.get("set-cookie"), null);
      assert.ok(!(await response.text()).includes("PRIVATE_NETWORK_DETAIL"));
    }
  } finally {
    globalThis.fetch = original;
  }
});

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";

const { unstable_rethrow } = createRequire(import.meta.url)("next/navigation");
const backend = "http://backend.example.invalid";
const token = "verified-session-token";
const empty = {
  document: null,
  phone: null,
  institution: null,
  unavailable: true,
};

function profileReader() {
  const mod = { exports: {} };
  const source = ts.transpileModule(
    fs.readFileSync("features/client/server/profile.ts", "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  new Function("require", "module", "exports", source)(
    (name) => {
      if (name === "server-only") return {};
      if (name === "@/config/server") return { serverApiUrl: () => backend };
      if (name === "next/navigation") return { unstable_rethrow };
      throw new Error("Unexpected dependency: " + name);
    },
    mod,
    mod.exports,
  );
  return mod.exports.getClientDetails;
}

function fetchFixture(t, handle) {
  const original = global.fetch;
  t.after(() => {
    global.fetch = original;
  });
  global.fetch = handle;
}

test("CLIENT business profile comes only from Spring with the verified token and no browser IDs", async (t) => {
  const calls = [];
  fetchFixture(t, async (url, options) => {
    calls.push({ url, options });
    assert.equal(url, backend + "/api/me/profile");
    return Response.json({
      document: "12345",
      phone: null,
      institution: "Own university",
      userId: "PRIVATE_ID",
    });
  });
  assert.deepEqual(await profileReader()(token), {
    document: "12345",
    phone: null,
    institution: "Own university",
    unavailable: false,
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].options.headers, {
    authorization: "Bearer " + token,
  });
  assert.equal(calls[0].options.cache, "no-store");
  assert.equal(calls[0].options.redirect, "error");
  assert.ok(calls[0].options.signal instanceof AbortSignal);
  assert.equal(calls[0].options.body, undefined);
});

test("401, 403 and 404 deny business fields without forwarding private errors", async (t) => {
  const statuses = [401, 403, 404];
  fetchFixture(t, async () =>
    Response.json(
      { message: "PRIVATE_BACKEND_DETAIL", document: "FOREIGN" },
      { status: statuses.shift() },
    ),
  );
  for (let attempt = 0; attempt < 3; attempt++)
    assert.deepEqual(await profileReader()(token), empty);
});

test("503 and network failure allow subsequent profile recovery", async (t) => {
  let attempts = 0;
  fetchFixture(t, async () => {
    attempts++;
    if (attempts === 1)
      return Response.json(
        { message: "PRIVATE_BACKEND_OUTAGE" },
        { status: 503 },
      );
    if (attempts === 2) throw new TypeError("PRIVATE_NETWORK_DETAIL");
    return Response.json({
      document: "12345",
      phone: null,
      institution: "Own university",
    });
  });
  const read = profileReader();
  assert.deepEqual(await read(token), empty);
  assert.deepEqual(await read(token), empty);
  assert.equal((await read(token)).unavailable, false);
});

test("timeout returns only the existing safe fallback", async (t) => {
  fetchFixture(t, async () => {
    throw new DOMException("PRIVATE_TIMEOUT_DETAIL", "TimeoutError");
  });
  assert.deepEqual(await profileReader()(token), empty);
});

test("unavailable institution preserves the student's document and phone", async (t) => {
  fetchFixture(t, async () =>
    Response.json({
      document: "12345",
      phone: "3001234567",
      institution: null,
    }),
  );
  assert.deepEqual(await profileReader()(token), {
    document: "12345",
    phone: "3001234567",
    institution: null,
    unavailable: true,
  });
});

test("malformed success payloads and invalid JSON never become profile data", async (t) => {
  const responses = [
    null,
    [],
    {},
    { document: 123, phone: null, institution: "Own" },
    { document: "12345", phone: [], institution: "Own" },
  ].map((data) => Response.json(data));
  responses.push(new Response("PRIVATE_INVALID_JSON", { status: 200 }));
  const count = responses.length;
  fetchFixture(t, async () => responses.shift());
  for (let attempt = 0; attempt < count; attempt++)
    assert.deepEqual(await profileReader()(token), empty);
});

test("framework rendering control signals are rethrown instead of becoming a partial profile", async (t) => {
  const dynamic = Object.assign(new Error("framework rendering control"), {
    digest: "DYNAMIC_SERVER_USAGE",
  });
  fetchFixture(t, async () => {
    throw dynamic;
  });
  await assert.rejects(profileReader()(token), (error) => error === dynamic);
});

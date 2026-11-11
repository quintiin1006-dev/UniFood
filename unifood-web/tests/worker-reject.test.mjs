import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { availabilityLoader } from "./helpers/load-availability.mjs";

const ORDER = "00000000-0000-0000-0000-000000000061";
const worker = {
  accessToken: "verified-worker-token",
  profile: { id: "worker", active: true, roles: ["WORKER"] },
};
const rejected = {
  id: ORDER,
  cafeteriaId: "00000000-0000-0000-0000-000000000002",
  clientId: null,
  clientName: "Ana Torres",
  clientCode: "1234567",
  clientType: "STUDENT",
  status: "CANCELLED",
  total: 13000,
  createdAt: "2026-11-20T16:00:00Z",
  updatedAt: "2026-11-20T17:00:00Z",
  items: [],
};

function route({ auth = worker, fetchMock } = {}) {
  const calls = [];
  const load = availabilityLoader({
    fetchMock: async (url, options) => {
      calls.push({ url: String(url), options });
      if (fetchMock) return fetchMock(url, options);
      return Response.json(rejected);
    },
    mocks: {
      "@/features/auth/server/session": { getAuth: async () => auth },
    },
  });
  return { calls, PATCH: load("app/api/orders/[[...path]]/route.ts").PATCH };
}

function reject(handler, body, { origin = "http://localhost:3100" } = {}) {
  return handler(
    new Request(`http://localhost:3100/api/orders/${ORDER}/reject`, {
      method: "PATCH",
      headers: {
        host: "localhost:3100",
        ...(origin ? { origin } : {}),
        authorization: "Bearer forged-by-browser",
        "content-type": "application/json",
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ path: [ORDER, "reject"] }) },
  );
}

// ---------------------------------------------------------------- reason rule

test("the reason is trimmed before it is checked and counts characters like PostgreSQL", () => {
  const { checkRejectionReason, reasonLength } = availabilityLoader()(
    "features/orders/rejectionReason.ts",
  );
  for (const value of [undefined, null, 5, "", "   ", "\t\n", "ab", "  ab  "])
    assert.equal(
      checkRejectionReason(value).code,
      "REJECTION_REASON_REQUIRED",
      String(value),
    );
  assert.deepEqual(checkRejectionReason("  Se acabó el pollo  "), {
    ok: true,
    reason: "Se acabó el pollo",
  });
  assert.equal(checkRejectionReason("ñ".repeat(200)).ok, true);
  assert.equal(
    checkRejectionReason(` ${"a".repeat(201)} `).code,
    "REJECTION_REASON_TOO_LONG",
  );
  assert.equal(reasonLength("  ñandú  "), 5);
});

// ---------------------------------------------------------------- BFF

test("the BFF forwards only the trimmed reason with the session bearer", async () => {
  const { calls, PATCH } = route();
  const response = await reject(PATCH, {
    reason: "  Se acabó el pollo  ",
    rejectedBy: "forged-worker",
    status: "DELIVERED",
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(calls.length, 1);
  const [{ url, options }] = calls;
  assert.equal(url, `http://backend.test:8080/api/orders/${ORDER}/reject`);
  assert.equal(options.method, "PATCH");
  assert.equal(options.cache, "no-store");
  assert.equal(options.redirect, "error");
  assert.ok(options.signal instanceof AbortSignal);
  assert.equal(
    options.headers.get("authorization"),
    "Bearer verified-worker-token",
  );
  assert.equal(options.headers.get("content-type"), "application/json");
  assert.deepEqual(JSON.parse(options.body), { reason: "Se acabó el pollo" });
});

test("a bad reason never reaches Spring", async () => {
  for (const [body, code] of [
    [{}, "REJECTION_REASON_REQUIRED"],
    [{ reason: "   " }, "REJECTION_REASON_REQUIRED"],
    [{ reason: "ab" }, "REJECTION_REASON_REQUIRED"],
    [{ reason: 42 }, "REJECTION_REASON_REQUIRED"],
    ["{not json", "REJECTION_REASON_REQUIRED"],
    ["[]", "REJECTION_REASON_REQUIRED"],
    [{ reason: "x".repeat(201) }, "REJECTION_REASON_TOO_LONG"],
    [{ reason: "x".repeat(3000) }, "REJECTION_REASON_REQUIRED"],
  ]) {
    const { calls, PATCH } = route();
    const response = await reject(PATCH, body);
    assert.equal(response.status, 400, JSON.stringify(body).slice(0, 40));
    assert.equal((await response.json()).code, code);
    assert.equal(calls.length, 0);
  }
});

test("origin, session and role are checked before the reason or Spring", async () => {
  for (const [options, auth, status] of [
    [{ origin: "https://evil.example" }, worker, 403],
    [{ origin: null }, worker, 403],
    [{}, null, 401],
    [{}, { ...worker, profile: { ...worker.profile, roles: ["CLIENT"] } }, 403],
    [{}, { ...worker, profile: { ...worker.profile, roles: ["ADMIN"] } }, 403],
  ]) {
    const { calls, PATCH } = route({ auth });
    const response = await reject(PATCH, { reason: "" }, options);
    assert.equal(response.status, status);
    assert.equal(calls.length, 0);
  }
});

test("Spring's conflict and forbidden answers keep their status", async () => {
  for (const [status, code] of [
    [409, "INVALID_ORDER_STATE"],
    [403, "FORBIDDEN"],
    [400, "REJECTION_REASON_TOO_LONG"],
  ]) {
    const { PATCH } = route({
      fetchMock: async () =>
        Response.json({ status, code, message: "Mensaje fijo" }, { status }),
    });
    const response = await reject(PATCH, { reason: "Se acabó el pollo" });
    assert.equal(response.status, status);
    assert.equal((await response.json()).code, code);
  }
});

// ---------------------------------------------------------------- UI

function components() {
  return availabilityLoader()(
    "features/orders/components/RejectOrderDialog.tsx",
  );
}

const order = (status) => ({
  id: ORDER,
  student: "Ana Torres",
  clientCode: "1234567",
  clientType: "STUDENT",
  createdAt: "2026-11-20T16:00:00Z",
  updatedAt: "2026-11-20T16:00:00Z",
  items: [],
  status,
});

test("the Rechazar button shows only on pending and preparing cards", () => {
  const { RejectOrderButton } = components();
  for (const status of ["pending", "preparing"]) {
    const html = renderToStaticMarkup(
      React.createElement(RejectOrderButton, {
        order: order(status),
        onReject() {},
      }),
    );
    assert.match(html, /Rechazar/);
    assert.match(html, /aria-label="Rechazar pedido de Ana Torres"/);
  }
  for (const status of [
    "ready",
    "called",
    "delivered",
    "cancelled",
    "not_collected",
  ])
    assert.equal(
      renderToStaticMarkup(
        React.createElement(RejectOrderButton, {
          order: order(status),
          onReject() {},
        }),
      ),
      "",
    );
  const busy = renderToStaticMarkup(
    React.createElement(RejectOrderButton, {
      order: order("pending"),
      busy: true,
      onReject() {},
    }),
  );
  assert.match(busy, /disabled=""/);
});

test("the dialog asks for a mandatory reason, counts it and says the client will see it", () => {
  const { RejectOrderDialog } = components();
  const render = (initialReason) =>
    renderToStaticMarkup(
      React.createElement(RejectOrderDialog, {
        order: order("preparing"),
        onClose() {},
        onConfirm: async () => ({ error: "x" }),
        initialReason,
      }),
    );
  const empty = render("");
  assert.match(empty, /role="dialog"/);
  assert.match(empty, /aria-modal="true"/);
  assert.match(empty, /¿Rechazar pedido\?/);
  assert.match(empty, /Ana Torres/);
  assert.match(empty, /Motivo del rechazo/);
  assert.match(empty, /El cliente verá este motivo\./);
  assert.match(empty, /0\/200/);
  // Without a valid reason the submit stays disabled.
  assert.match(empty, /<button type="submit"[^>]*disabled=""/);

  const valid = render("  Se acabó el pollo ");
  assert.match(valid, /17\/200/);
  assert.doesNotMatch(valid, /<button type="submit"[^>]*disabled=""/);

  const tooLong = render("x".repeat(205));
  assert.match(tooLong, /205\/200/);
  assert.match(tooLong, /counterOver/);
  assert.match(tooLong, /<button type="submit"[^>]*disabled=""/);
});

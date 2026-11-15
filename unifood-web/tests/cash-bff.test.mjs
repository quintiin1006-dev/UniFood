import { test } from "node:test";
import assert from "node:assert/strict";
import { availabilityLoader } from "./helpers/load-availability.mjs";

// BFF of the cash register: same origin, session, role, strict body, fixed messages and never
// a cafeteria id towards Spring (docs/decisiones.md §14).
const ORIGIN = "http://localhost:3100";
const SESSION = "00000000-0000-4000-8000-0000000000a1";
const worker = {
  profile: { active: true, roles: ["WORKER"] },
  accessToken: "worker-token",
};
const admin = {
  profile: { active: true, roles: ["ADMIN"] },
  accessToken: "admin-token",
};
const superAdmin = {
  profile: { active: true, roles: ["SUPER_ADMIN"] },
  accessToken: "super-token",
};
const client = {
  profile: { active: true, roles: ["CLIENT"] },
  accessToken: "client-token",
};

function session(overrides = {}) {
  return {
    id: SESSION,
    cafeteria: {
      id: "00000000-0000-4000-8000-0000000000c1",
      name: "Cafetería Central",
    },
    shift: "LUNCH",
    businessDate: "2026-11-20",
    sequenceNumber: 3,
    status: "OPEN",
    openingFloat: 50000,
    openedAt: "2026-11-20T16:00:00Z",
    openedByName: "Wilson",
    closedAt: null,
    closedByName: null,
    sales: null,
    income: null,
    expense: null,
    expected: null,
    counted: null,
    difference: null,
    outcome: null,
    toleranceCop: null,
    outsideTolerance: null,
    note: null,
    pendingOrdersAtClose: null,
    forcedClose: null,
    reopenCount: 0,
    reopenedAt: null,
    reopenedByName: null,
    reopenReason: null,
    version: 0,
    ...overrides,
  };
}

const current = () => ({
  businessDate: "2026-11-20",
  session: session(),
  live: {
    openingFloat: 50000,
    sales: 13000,
    deliveredOrders: 1,
    income: 0,
    expense: 0,
    expected: 63000,
  },
  movements: [],
  pendingOrders: [],
  unsessionedToday: { orders: 0, amount: 0 },
  stale: false,
  toleranceCop: 2000,
  settingsVersion: 0,
});

function routes(fetchMock, auth) {
  return availabilityLoader({
    fetchMock,
    mocks: { "@/features/auth/server/session": { getAuth: async () => auth } },
  });
}

const json = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

function post(path, body, origin = ORIGIN) {
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(origin ? { origin } : {}),
    },
    body: JSON.stringify(body),
  });
}

test("current: only a WORKER or ADMIN, with the session Bearer and no-store", async () => {
  const calls = [];
  const fetchMock = async (url, init) => {
    calls.push({ url, init });
    return json(200, current());
  };
  for (const auth of [worker, admin]) {
    const { GET } = routes(fetchMock, auth)("app/api/cash/current/route.ts");
    const response = await GET(new Request(`${ORIGIN}/api/cash/current`));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal((await response.json()).live.expected, 63000);
  }
  assert.equal(calls[0].url, "http://backend.test:8080/api/cash/current");
  assert.equal(calls[0].init.cache, "no-store");
  assert.equal(calls[0].init.redirect, "error");
  assert.ok(calls[0].init.signal);
  assert.equal(calls[0].init.headers.authorization, "Bearer worker-token");
  for (const auth of [superAdmin, client, null]) {
    const before = calls.length;
    const { GET } = routes(fetchMock, auth)("app/api/cash/current/route.ts");
    const response = await GET(new Request(`${ORIGIN}/api/cash/current`));
    assert.equal(response.status, auth ? 403 : 401);
    assert.equal(calls.length, before, "Spring is never called");
  }
});

test("mutations need the same origin and a strict body; the cafeteria never travels", async () => {
  const calls = [];
  const fetchMock = async (url, init) => {
    calls.push({ url, init });
    return json(200, current());
  };
  const { POST } = routes(fetchMock, worker)("app/api/cash/sessions/route.ts");
  for (const origin of ["https://evil.example", ""]) {
    const response = await POST(
      post("/api/cash/sessions", { shift: "LUNCH", openingFloat: 0 }, origin),
    );
    assert.equal(response.status, 403);
  }
  const extra = await POST(
    post("/api/cash/sessions", {
      shift: "LUNCH",
      openingFloat: 0,
      cafeteriaId: "00000000-0000-4000-8000-0000000000c2",
    }),
  );
  assert.equal(extra.status, 400);
  assert.equal((await extra.json()).code, "CASH_INVALID_REQUEST");
  assert.equal(calls.length, 0);
  const ok = await POST(
    post("/api/cash/sessions", { shift: "LUNCH", openingFloat: 50000 }),
  );
  assert.equal(ok.status, 200);
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.body, '{"shift":"LUNCH","openingFloat":50000}');
});

test("a refused close keeps only its known code, fixed message and parsed extras", async () => {
  const pending = {
    id: "00000000-0000-4000-8000-0000000000d1",
    status: "CALLED",
    clientName: "Ana Torres",
    createdAt: "2026-11-20T16:10:00Z",
  };
  const fetchMock = async () =>
    json(409, {
      status: 409,
      code: "CASH_PENDING_ORDERS",
      message: "texto de Spring que no debe pasar",
      pendingOrders: [pending],
      stack: "secret",
    });
  const { POST } = routes(
    fetchMock,
    worker,
  )("app/api/cash/sessions/[sessionId]/close/route.ts");
  const body = {
    lines: [{ denomination: 50000, quantity: 1 }],
    note: null,
    expectedCash: 50000,
    expectedVersion: 0,
  };
  const response = await POST(
    post(`/api/cash/sessions/${SESSION}/close`, body),
    {
      params: Promise.resolve({ sessionId: SESSION }),
    },
  );
  assert.equal(response.status, 409);
  const problem = await response.json();
  assert.equal(problem.code, "CASH_PENDING_ORDERS");
  assert.doesNotMatch(problem.message, /Spring/);
  assert.deepEqual(problem.pendingOrders, [pending]);
  assert.equal(problem.stack, undefined);

  // An unknown 409 code is not trusted.
  const unknown = routes(
    async () => json(409, { code: "SOMETHING_ELSE" }),
    worker,
  )("app/api/cash/sessions/[sessionId]/close/route.ts");
  const bad = await unknown.POST(
    post(`/api/cash/sessions/${SESSION}/close`, body),
    {
      params: Promise.resolve({ sessionId: SESSION }),
    },
  );
  assert.equal(bad.status, 502);

  // CASH_BUSY keeps a bounded Retry-After.
  const busy = routes(
    async () => json(409, { code: "CASH_BUSY" }, { "retry-after": "3" }),
    worker,
  )("app/api/cash/sessions/[sessionId]/close/route.ts");
  const later = await busy.POST(
    post(`/api/cash/sessions/${SESSION}/close`, body),
    {
      params: Promise.resolve({ sessionId: SESSION }),
    },
  );
  assert.equal(later.status, 409);
  assert.equal(later.headers.get("retry-after"), "3");
});

test("reopen, list, export and tolerance belong to the ADMIN; SUPER_ADMIN only reads", async () => {
  let called = 0;
  const fetchMock = async () => {
    called += 1;
    return json(200, {});
  };
  const reopen = routes(
    fetchMock,
    worker,
  )("app/api/cash/sessions/[sessionId]/reopen/route.ts");
  const refused = await reopen.POST(
    post(`/api/cash/sessions/${SESSION}/reopen`, {
      reason: "Faltó registrar un retiro",
      expectedVersion: 1,
    }),
    { params: Promise.resolve({ sessionId: SESSION }) },
  );
  assert.equal(refused.status, 403);
  const list = routes(fetchMock, worker)("app/api/cash/sessions/route.ts");
  assert.equal(
    (
      await list.GET(
        new Request(
          `${ORIGIN}/api/cash/sessions?from=2026-11-01&to=2026-11-20`,
        ),
      )
    ).status,
    403,
  );
  const superList = routes(
    fetchMock,
    admin,
  )("app/api/super-admin/cash/sessions/route.ts");
  assert.equal(
    (
      await superList.GET(
        new Request(
          `${ORIGIN}/api/super-admin/cash/sessions?from=2026-11-01&to=2026-11-20`,
        ),
      )
    ).status,
    403,
  );
  assert.equal(called, 0);
  const badRange = routes(fetchMock, admin)("app/api/cash/sessions/route.ts");
  for (const query of [
    "from=2026-11-01",
    "from=2026-11-01&to=x",
    "from=2026-11-01&to=2026-11-02&cafeteriaId=" + SESSION,
  ])
    assert.equal(
      (await badRange.GET(new Request(`${ORIGIN}/api/cash/sessions?${query}`)))
        .status,
      400,
      query,
    );
  assert.equal(called, 0);
});

test("the CSV passes through as an attachment and only as text/csv", async () => {
  const csv = '﻿Consecutivo;Cafetería\r\n1;"Central"\r\n';
  const fetchMock = async (url) => {
    assert.equal(
      url,
      "http://backend.test:8080/api/cash/sessions/export?from=2026-11-01&to=2026-11-20",
    );
    return new Response(csv, {
      status: 200,
      headers: {
        "content-type": "text/csv;charset=UTF-8",
        "content-disposition":
          'attachment; filename="cierres-de-caja-2026-11-01-a-2026-11-20.csv"',
      },
    });
  };
  const { GET } = routes(
    fetchMock,
    admin,
  )("app/api/cash/sessions/export/route.ts");
  const response = await GET(
    new Request(
      `${ORIGIN}/api/cash/sessions/export?from=2026-11-01&to=2026-11-20`,
    ),
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /^text\/csv/);
  assert.match(
    response.headers.get("content-disposition"),
    /cierres-de-caja-2026-11-01-a-2026-11-20\.csv/,
  );
  const bytes = new Uint8Array(await response.arrayBuffer());
  assert.deepEqual(
    [...bytes.slice(0, 3)],
    [0xef, 0xbb, 0xbf],
    "UTF-8 BOM kept",
  );

  const html = routes(
    async () =>
      new Response("<html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    admin,
  )("app/api/cash/sessions/export/route.ts");
  assert.equal(
    (
      await html.GET(
        new Request(
          `${ORIGIN}/api/cash/sessions/export?from=2026-11-01&to=2026-11-20`,
        ),
      )
    ).status,
    502,
  );
});

test("a malformed Spring answer is a 502, never passed to the panel", async () => {
  const { GET } = routes(
    async () => json(200, { ...current(), live: { expected: "63000" } }),
    worker,
  )("app/api/cash/current/route.ts");
  const response = await GET(new Request(`${ORIGIN}/api/cash/current`));
  assert.equal(response.status, 502);
  assert.equal((await response.json()).code, "CASH_BAD_GATEWAY");
});

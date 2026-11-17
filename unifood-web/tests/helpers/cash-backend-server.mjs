// Loopback-only Spring stand-in for tests/e2e/cash.spec.ts. Never used by the app runtime.
//
// The browser fixtures sign no real JWT (auth-provider-server.mjs), so the real Spring cannot
// validate them. This server answers /api/cash/** and /api/super-admin/cash/** with the same
// contract and business codes as CashSessionService (docs/decisiones.md §14), keeps its state in
// memory, and forwards every other path to the auth provider, which already simulates the rest of
// Spring. The rules themselves are proven on real PostgreSQL by CashSessionApiPostgresTest.
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

const PORT = Number(process.env.CASH_BACKEND_PORT ?? 8700);
const PROVIDER = `http://127.0.0.1:${Number(process.env.AUTH_PROVIDER_PORT ?? 3701)}`;
const ZONE = "America/Bogota";
const CAFETERIAS = {
  central: {
    id: "00000000-0000-0000-0000-000000000002",
    name: "Cafetería Central",
  },
  norte: {
    id: "00000000-0000-0000-0000-0000000000c2",
    name: "Cafetería Norte",
  },
};
// Fixture accounts of auth-provider-server.mjs, by email.
const OPERATORS = {
  "worker@example.invalid": {
    cafeteria: "central",
    admin: false,
    name: "Wilson Cajero",
  },
  "admin@example.invalid": {
    cafeteria: "central",
    admin: true,
    name: "Admin Central",
  },
  "adminother@example.invalid": {
    cafeteria: "norte",
    admin: true,
    name: "Admin Norte",
  },
};
const SUPER_ADMIN = "superadmin@example.invalid";
const DENOMINATIONS = [
  50000, 20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50,
];
const MESSAGES = {
  CASH_FORBIDDEN: "No tienes permisos para operar la caja.",
  CASH_INVALID_REQUEST: "Revisa los datos e inténtalo de nuevo.",
  CASH_INVALID_AMOUNT: "Escribe un monto en pesos enteros, sin decimales.",
  CASH_REASON_REQUIRED: "Escribe el motivo del movimiento.",
  CASH_NOTE_REQUIRED: "Explica la diferencia.",
  CASH_REOPEN_REASON_REQUIRED: "Escribe el motivo de la reapertura.",
  CASH_SESSION_NOT_FOUND: "No encontramos esa caja.",
  CASH_SESSION_ALREADY_OPEN: "Ya hay una caja abierta.",
  CASH_STALE_SESSION_OPEN: "Quedó abierta la caja de otro día.",
  CASH_SHIFT_ALREADY_USED: "La caja de este turno ya se cerró hoy.",
  CASH_SESSION_CLOSED: "Esta caja ya está cerrada.",
  CASH_SESSION_NOT_CLOSED: "Solo se puede reabrir una caja cerrada.",
  CASH_STATE_CHANGED: "La caja cambió.",
  CASH_EXPECTED_CHANGED: "Hubo ventas nuevas.",
  CASH_PENDING_ORDERS: "Hay pedidos sin resolver.",
  CASH_EXPENSE_EXCEEDS_BALANCE: "El egreso supera el efectivo esperado.",
  CASH_REOPEN_NOT_LATEST: "Solo la última caja.",
  CASH_TOLERANCE_CHANGED: "Otra persona cambió la tolerancia.",
};

let state;
function reset() {
  state = {
    calls: [],
    cafeterias: Object.fromEntries(
      Object.keys(CAFETERIAS).map((key) => [
        key,
        {
          tolerance: 2000,
          settingsVersion: 0,
          lastSequence: 0,
          sessions: [],
          sales: [],
          pending: [],
        },
      ]),
    ),
  };
}
reset();

const bogotaDate = (ms) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
const dayStart = (date) => Date.parse(`${date}T05:00:00Z`); // Bogota is UTC-5, no DST.

function send(response, status, body, headers = {}) {
  response.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
    ...headers,
  });
  response.end(body === undefined ? "" : JSON.stringify(body));
}
function problem(response, status, code, extras = {}) {
  send(
    response,
    status,
    {
      status,
      code,
      message: MESSAGES[code] ?? "Error",
      timestamp: new Date().toISOString(),
      path: "",
      ...extras,
    },
    code === "CASH_BUSY" ? { "retry-after": "3" } : {},
  );
}
async function readJson(request) {
  let raw = "";
  for await (const chunk of request) raw += chunk;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function identity(request) {
  const authorization = request.headers.authorization;
  if (!authorization) return null;
  const upstream = await fetch(`${PROVIDER}/auth/v1/user`, {
    headers: { authorization, apikey: "fixture" },
  });
  if (upstream.status !== 200) return null;
  const user = await upstream.json();
  return { id: user.id, email: user.email };
}

// ---------------------------------------------------------------- arithmetic (whole pesos)

function balance(cafe, session, until) {
  const from = Date.parse(session.openedAt);
  const sold = cafe.sales.filter((s) => s.at >= from && s.at < until);
  const moves = session.movements;
  const income = moves
    .filter((m) => m.kind === "INCOME")
    .reduce((t, m) => t + m.amount, 0);
  const expense = moves
    .filter((m) => m.kind === "EXPENSE")
    .reduce((t, m) => t + m.amount, 0);
  const sales = sold.reduce((t, s) => t + s.total, 0);
  return {
    openingFloat: session.openingFloat,
    sales,
    deliveredOrders: sold.length,
    income,
    expense,
    expected: session.openingFloat + sales + income - expense,
  };
}
const outcome = (difference) =>
  difference === 0 ? "BALANCED" : difference > 0 ? "SURPLUS" : "SHORTAGE";

function countLines(value) {
  if (!Array.isArray(value)) return null;
  const quantities = new Map();
  for (const line of value) {
    if (
      !line ||
      !DENOMINATIONS.includes(line.denomination) ||
      !Number.isInteger(line.quantity) ||
      line.quantity < 0 ||
      line.quantity > 10000 ||
      quantities.has(line.denomination)
    )
      return null;
    quantities.set(line.denomination, line.quantity);
  }
  return quantities;
}
const countTotal = (quantities) =>
  [...quantities].reduce((t, [d, q]) => t + d * q, 0);

function view(cafeKey, session) {
  const closed = session.status === "CLOSED";
  return {
    id: session.id,
    cafeteria: CAFETERIAS[cafeKey],
    shift: session.shift,
    businessDate: session.businessDate,
    sequenceNumber: session.sequenceNumber,
    status: session.status,
    openingFloat: session.openingFloat,
    openedAt: session.openedAt,
    openedByName: session.openedByName,
    closedAt: closed ? session.closedAt : null,
    closedByName: closed ? session.closedByName : null,
    sales: closed ? session.figures.sales : null,
    income: closed ? session.figures.income : null,
    expense: closed ? session.figures.expense : null,
    expected: closed ? session.figures.expected : null,
    counted: closed ? session.figures.counted : null,
    difference: closed ? session.figures.difference : null,
    outcome: closed ? outcome(session.figures.difference) : null,
    toleranceCop: closed ? session.figures.tolerance : null,
    outsideTolerance: closed
      ? Math.abs(session.figures.difference) > session.figures.tolerance
      : null,
    note: closed ? session.note : null,
    pendingOrdersAtClose: closed ? session.figures.pending : null,
    forcedClose: closed ? session.figures.pending > 0 : null,
    reopenCount: session.reopenCount,
    reopenedAt: session.reopenedAt,
    reopenedByName: session.reopenedByName,
    reopenReason: session.reopenReason,
    version: session.version,
  };
}
const movementView = (m) => ({
  id: m.id,
  kind: m.kind,
  amount: m.amount,
  reason: m.reason,
  createdAt: m.createdAt,
  createdByName: m.createdByName,
});
function detail(cafeKey, session) {
  return {
    session: view(cafeKey, session),
    movements: session.movements.map(movementView),
    countLines:
      session.status === "CLOSED"
        ? [...session.lines]
            .filter(([, q]) => q > 0)
            .map(([denomination, quantity]) => ({ denomination, quantity }))
        : [],
  };
}
function unsessioned(cafe, date) {
  const from = dayStart(date);
  const to = from + 86_400_000;
  const outside = cafe.sales.filter(
    (s) =>
      s.at >= from &&
      s.at < to &&
      !cafe.sessions.some(
        (x) =>
          s.at >= Date.parse(x.openedAt) &&
          (x.status !== "CLOSED" || s.at < Date.parse(x.closedAt)),
      ),
  );
  return {
    orders: outside.length,
    amount: outside.reduce((t, s) => t + s.total, 0),
  };
}
const openSession = (cafe) =>
  cafe.sessions.find((s) => s.status !== "CLOSED") ?? null;
const pendingView = (cafe) =>
  cafe.pending.map((p) => ({
    id: p.id,
    status: p.status,
    clientName: p.clientName,
    createdAt: p.createdAt,
  }));

function current(cafeKey) {
  const cafe = state.cafeterias[cafeKey];
  const now = Date.now();
  const today = bogotaDate(now);
  const session = openSession(cafe);
  return {
    businessDate: today,
    session: session ? view(cafeKey, session) : null,
    live: session ? balance(cafe, session, now) : null,
    movements: session ? session.movements.map(movementView) : [],
    pendingOrders: pendingView(cafe),
    unsessionedToday: unsessioned(cafe, today),
    stale: session ? session.businessDate < today : false,
    toleranceCop: cafe.tolerance,
    settingsVersion: cafe.settingsVersion,
  };
}
function preview(cafeKey, session, quantities) {
  const cafe = state.cafeterias[cafeKey];
  const live = balance(cafe, session, Date.now());
  const counted = countTotal(quantities);
  const difference = counted - live.expected;
  return {
    openingFloat: live.openingFloat,
    sales: live.sales,
    income: live.income,
    expense: live.expense,
    expected: live.expected,
    counted,
    difference,
    outcome: outcome(difference),
    withinTolerance: Math.abs(difference) <= cafe.tolerance,
    toleranceCop: cafe.tolerance,
    noteRequired: difference !== 0,
    pendingOrders: pendingView(cafe),
    version: session.version,
  };
}
function listing(keys, from, to, withSettings) {
  const today = bogotaDate(Date.now());
  const sessions = keys.flatMap((key) =>
    state.cafeterias[key].sessions
      .filter((s) => s.businessDate >= from && s.businessDate <= to)
      .map((s) => view(key, s)),
  );
  sessions.sort(
    (a, b) =>
      b.businessDate.localeCompare(a.businessDate) ||
      b.sequenceNumber - a.sequenceNumber,
  );
  const one = keys.length === 1 ? state.cafeterias[keys[0]] : null;
  return {
    businessDate: today,
    sessions,
    staleSessions: keys.flatMap((key) =>
      state.cafeterias[key].sessions
        .filter((s) => s.status !== "CLOSED" && s.businessDate < today)
        .map((s) => ({
          id: s.id,
          cafeteria: CAFETERIAS[key],
          businessDate: s.businessDate,
          shift: s.shift,
          openedAt: s.openedAt,
        })),
    ),
    unsessionedToday: one ? unsessioned(one, today) : null,
    toleranceCop: withSettings && one ? one.tolerance : null,
    settingsVersion: withSettings && one ? one.settingsVersion : null,
  };
}
function csv(keys, from, to) {
  const header =
    "Consecutivo;Cafetería;Fecha;Turno;Estado;Apertura;Cierre;Fondo inicial;Ventas en efectivo;Otros ingresos;Egresos;Efectivo esperado;Efectivo contado;Diferencia;Resultado;Tolerancia;Fuera de tolerancia;Cierre con pedidos pendientes;Nota;Abrió;Cerró;Reaperturas;Último motivo de reapertura";
  const rows = listing(keys, from, to, false).sessions.map((s) =>
    [
      s.sequenceNumber,
      `"${s.cafeteria.name}"`,
      s.businessDate,
      s.shift === "BREAKFAST" ? "Desayuno" : "Almuerzo",
      { OPEN: "Abierta", CLOSED: "Cerrada", REOPENED: "Reabierta" }[s.status],
      s.openedAt.slice(0, 16).replace("T", " "),
      s.closedAt ? s.closedAt.slice(0, 16).replace("T", " ") : "",
      s.openingFloat,
      s.sales ?? "",
      s.income ?? "",
      s.expense ?? "",
      s.expected ?? "",
      s.counted ?? "",
      s.difference ?? "",
      s.outcome
        ? { BALANCED: "Cuadra", SURPLUS: "Sobrante", SHORTAGE: "Faltante" }[
            s.outcome
          ]
        : "",
      s.toleranceCop ?? "",
      s.outsideTolerance === null ? "" : s.outsideTolerance ? "Sí" : "No",
      s.forcedClose === null ? "" : s.forcedClose ? "Sí" : "No",
      s.note ? `"${s.note.replace(/"/g, '""')}"` : "",
      `"${s.openedByName}"`,
      s.closedByName ? `"${s.closedByName}"` : "",
      s.reopenCount,
      s.reopenReason ? `"${s.reopenReason}"` : "",
    ].join(";"),
  );
  return `﻿${header}\r\n${rows.map((r) => `${r}\r\n`).join("")}`;
}

// ---------------------------------------------------------------- routes

async function cash(request, response, url) {
  const who = await identity(request);
  if (!who) return send(response, 401, { status: 401, code: "UNAUTHORIZED" });
  state.calls.push({
    method: request.method,
    path: url.pathname,
    email: who.email,
  });
  const superAdmin = who.email === SUPER_ADMIN;
  const path = url.pathname;
  const range = () => {
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    return from && to && from <= to ? { from, to } : null;
  };

  if (path.startsWith("/api/super-admin/cash/")) {
    if (!superAdmin) return problem(response, 403, "CASH_FORBIDDEN");
    const keys = Object.keys(CAFETERIAS);
    if (
      path === "/api/super-admin/cash/sessions" ||
      path === "/api/super-admin/cash/sessions/export"
    ) {
      const r = range();
      if (!r) return problem(response, 400, "CASH_INVALID_REQUEST");
      if (path.endsWith("/export")) {
        response.writeHead(200, {
          "content-type": "text/csv;charset=UTF-8",
          "content-disposition": `attachment; filename="cierres-de-caja-${r.from}-a-${r.to}.csv"`,
        });
        return response.end(csv(keys, r.from, r.to));
      }
      return send(response, 200, listing(keys, r.from, r.to, false));
    }
    const id = path.split("/").pop();
    for (const key of keys) {
      const session = state.cafeterias[key].sessions.find((s) => s.id === id);
      if (session) return send(response, 200, detail(key, session));
    }
    return problem(response, 404, "CASH_SESSION_NOT_FOUND");
  }

  // /api/cash/**: a WORKER or ADMIN of exactly one cafeteria; SUPER_ADMIN never operates.
  const op = OPERATORS[who.email];
  if (!op) return problem(response, 403, "CASH_FORBIDDEN");
  const key = op.cafeteria;
  const cafe = state.cafeterias[key];
  const body = request.method === "GET" ? null : await readJson(request);
  const now = Date.now();
  const iso = new Date(now).toISOString();

  if (path === "/api/cash/current" && request.method === "GET")
    return send(response, 200, current(key));

  if (path === "/api/cash/sessions" && request.method === "POST") {
    if (
      !body ||
      !["BREAKFAST", "LUNCH"].includes(body.shift) ||
      !Number.isInteger(body.openingFloat)
    )
      return problem(response, 400, "CASH_INVALID_REQUEST");
    const today = bogotaDate(now);
    const open = openSession(cafe);
    if (open)
      return problem(
        response,
        409,
        open.businessDate < today
          ? "CASH_STALE_SESSION_OPEN"
          : "CASH_SESSION_ALREADY_OPEN",
      );
    if (
      cafe.sessions.some(
        (s) => s.businessDate === today && s.shift === body.shift,
      )
    )
      return problem(response, 409, "CASH_SHIFT_ALREADY_USED");
    cafe.lastSequence += 1;
    cafe.sessions.push({
      id: randomUUID(),
      shift: body.shift,
      businessDate: today,
      sequenceNumber: cafe.lastSequence,
      status: "OPEN",
      openingFloat: body.openingFloat,
      openedAt: iso,
      openedByName: op.name,
      movements: [],
      requests: new Set(),
      lines: new Map(),
      reopenCount: 0,
      reopenedAt: null,
      reopenedByName: null,
      reopenReason: null,
      version: 0,
    });
    return send(response, 200, current(key));
  }

  if (path === "/api/cash/sessions" && request.method === "GET") {
    if (!op.admin) return problem(response, 403, "CASH_FORBIDDEN");
    const r = range();
    return r
      ? send(response, 200, listing([key], r.from, r.to, true))
      : problem(response, 400, "CASH_INVALID_REQUEST");
  }
  if (path === "/api/cash/sessions/export") {
    if (!op.admin) return problem(response, 403, "CASH_FORBIDDEN");
    const r = range();
    if (!r) return problem(response, 400, "CASH_INVALID_REQUEST");
    response.writeHead(200, {
      "content-type": "text/csv;charset=UTF-8",
      "content-disposition": `attachment; filename="cierres-de-caja-${r.from}-a-${r.to}.csv"`,
    });
    return response.end(csv([key], r.from, r.to));
  }
  if (path === "/api/cash/settings" && request.method === "PUT") {
    if (!op.admin) return problem(response, 403, "CASH_FORBIDDEN");
    if (!body || !Number.isInteger(body.toleranceCop))
      return problem(response, 400, "CASH_INVALID_AMOUNT");
    if (body.toleranceCop !== cafe.tolerance) {
      if (body.expectedVersion !== cafe.settingsVersion)
        return problem(response, 409, "CASH_TOLERANCE_CHANGED");
      cafe.tolerance = body.toleranceCop;
      cafe.settingsVersion += 1;
    }
    return send(response, 200, {
      toleranceCop: cafe.tolerance,
      settingsVersion: cafe.settingsVersion,
    });
  }

  const match = /^\/api\/cash\/sessions\/([0-9a-f-]{36})(?:\/([a-z-]+))?$/.exec(
    path,
  );
  if (!match) return problem(response, 404, "CASH_SESSION_NOT_FOUND");
  // Another cafeteria's session does not exist for this operator.
  const session = cafe.sessions.find((s) => s.id === match[1]);
  if (!session) return problem(response, 404, "CASH_SESSION_NOT_FOUND");
  const action = match[2];
  if (!action && request.method === "GET")
    return send(response, 200, detail(key, session));

  if (action === "movements") {
    if (!body || !Number.isInteger(body.amount) || body.amount < 1)
      return problem(response, 400, "CASH_INVALID_AMOUNT");
    if (typeof body.reason !== "string" || [...body.reason.trim()].length < 3)
      return problem(response, 400, "CASH_REASON_REQUIRED");
    if (session.requests.has(body.requestId))
      return send(response, 200, current(key));
    if (session.status === "CLOSED")
      return problem(response, 409, "CASH_SESSION_CLOSED");
    if (
      body.kind === "EXPENSE" &&
      body.amount > balance(cafe, session, now).expected
    )
      return problem(response, 409, "CASH_EXPENSE_EXCEEDS_BALANCE");
    session.requests.add(body.requestId);
    session.movements.push({
      id: randomUUID(),
      kind: body.kind,
      amount: body.amount,
      reason: body.reason.trim(),
      createdAt: iso,
      createdByName: op.name,
    });
    return send(response, 200, current(key));
  }

  if (action === "close-preview") {
    const quantities = countLines(body?.lines);
    if (!quantities) return problem(response, 400, "CASH_INVALID_REQUEST");
    if (session.status === "CLOSED")
      return problem(response, 409, "CASH_SESSION_CLOSED");
    return send(response, 200, preview(key, session, quantities));
  }

  if (action === "close") {
    const quantities = countLines(body?.lines);
    if (!quantities) return problem(response, 400, "CASH_INVALID_REQUEST");
    if (session.status === "CLOSED")
      return problem(response, 409, "CASH_SESSION_CLOSED");
    if (body.force && !op.admin)
      return problem(response, 403, "CASH_FORBIDDEN");
    if (body.expectedVersion !== session.version)
      return problem(response, 409, "CASH_STATE_CHANGED");
    if (cafe.pending.length > 0 && !body.force)
      return problem(response, 409, "CASH_PENDING_ORDERS", {
        pendingOrders: pendingView(cafe),
      });
    const p = preview(key, session, quantities);
    if (p.expected !== body.expectedCash)
      return problem(response, 409, "CASH_EXPECTED_CHANGED", { preview: p });
    const note =
      typeof body.note === "string" ? body.note.trim() || null : null;
    if ((note && [...note].length < 10) || (p.difference !== 0 && !note))
      return problem(response, 400, "CASH_NOTE_REQUIRED");
    Object.assign(session, {
      status: "CLOSED",
      closedAt: iso,
      closedByName: op.name,
      note,
      lines: quantities,
      version: session.version + 1,
      figures: {
        sales: p.sales,
        income: p.income,
        expense: p.expense,
        expected: p.expected,
        counted: p.counted,
        difference: p.difference,
        tolerance: cafe.tolerance,
        pending: cafe.pending.length,
      },
    });
    return send(response, 200, detail(key, session));
  }

  if (action === "reopen") {
    if (!op.admin) return problem(response, 403, "CASH_FORBIDDEN");
    const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
    if ([...reason].length < 10)
      return problem(response, 400, "CASH_REOPEN_REASON_REQUIRED");
    if (session.status !== "CLOSED")
      return problem(response, 409, "CASH_SESSION_NOT_CLOSED");
    if (body.expectedVersion !== session.version)
      return problem(response, 409, "CASH_STATE_CHANGED");
    if (openSession(cafe))
      return problem(response, 409, "CASH_SESSION_ALREADY_OPEN");
    const latest = Math.max(...cafe.sessions.map((s) => s.sequenceNumber));
    if (session.sequenceNumber !== latest)
      return problem(response, 409, "CASH_REOPEN_NOT_LATEST");
    Object.assign(session, {
      status: "REOPENED",
      reopenCount: session.reopenCount + 1,
      reopenedAt: iso,
      reopenedByName: op.name,
      reopenReason: reason,
      version: session.version + 1,
    });
    return send(response, 200, detail(key, session));
  }
  return problem(response, 404, "CASH_SESSION_NOT_FOUND");
}

async function control(request, response, url) {
  const body = (await readJson(request)) ?? {};
  const cafe = state.cafeterias[body.cafeteria ?? "central"];
  if (url.pathname === "/__test/cash/reset") reset();
  else if (url.pathname === "/__test/cash/deliver")
    cafe.sales.push({
      total: body.total,
      at: Date.now() - (body.secondsAgo ?? 0) * 1000,
    });
  else if (url.pathname === "/__test/cash/pending")
    cafe.pending.push({
      id: randomUUID(),
      status: body.status ?? "CALLED",
      clientName: "Ana Torres",
      createdAt: new Date().toISOString(),
    });
  else if (url.pathname === "/__test/cash/resolve") cafe.pending = [];
  else if (url.pathname === "/__test/cash/calls")
    return send(response, 200, state.calls);
  else return send(response, 404, {});
  return send(response, 200, { ok: true });
}

async function forward(request, response, url) {
  const headers = { ...request.headers };
  delete headers.host;
  delete headers["content-length"];
  let raw;
  if (!["GET", "HEAD"].includes(request.method)) {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    raw = Buffer.concat(chunks);
  }
  const upstream = await fetch(`${PROVIDER}${url.pathname}${url.search}`, {
    method: request.method,
    headers,
    body: raw,
    redirect: "manual",
  });
  const out = {};
  upstream.headers.forEach((value, name) => {
    if (
      ![
        "content-encoding",
        "transfer-encoding",
        "content-length",
        "connection",
      ].includes(name)
    )
      out[name] = value;
  });
  response.writeHead(upstream.status, out);
  response.end(Buffer.from(await upstream.arrayBuffer()));
}

createServer(async (request, response) => {
  const url = new URL(request.url, `http://127.0.0.1:${PORT}`);
  try {
    if (url.pathname === "/health") return send(response, 200, { ok: true });
    if (url.pathname.startsWith("/__test/cash/"))
      return await control(request, response, url);
    if (
      url.pathname.startsWith("/api/cash/") ||
      url.pathname.startsWith("/api/super-admin/cash/")
    )
      return await cash(request, response, url);
    return await forward(request, response, url);
  } catch (error) {
    send(response, 500, {
      status: 500,
      code: "CASH_INTERNAL_ERROR",
      detail: String(error),
    });
  }
}).listen(PORT, "127.0.0.1");

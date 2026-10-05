// Loopback-only provider/backend fixture for browser tests. Never used by the app runtime.
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

const fixtures = Object.entries({
  client: ["CLIENT"],
  worker: ["WORKER"],
  unverifiedworker: ["WORKER"],
  admin: ["ADMIN"],
  superadmin: ["SUPER_ADMIN"],
  workeradmin: ["WORKER", "ADMIN"],
  workersuperadmin: ["WORKER", "SUPER_ADMIN"],
  clientworker: ["CLIENT", "WORKER"],
  clientadmin: ["CLIENT", "ADMIN"],
  clientsuperadmin: ["CLIENT", "SUPER_ADMIN"],
  adminsuperadmin: ["ADMIN", "SUPER_ADMIN"],
  norole: [],
  unknownrole: ["UNKNOWN"],
  inactive: ["WORKER"],
  unassigned: ["WORKER"],
  multiassigned: ["WORKER"],
}).map(([name, roles]) => ({
  id: randomUUID(),
  email: `${name}@example.invalid`,
  fullName: "Usuario de prueba",
  active: name !== "inactive",
  roles,
  assignments: name === "unassigned" ? 0 : name === "multiassigned" ? 2 : 1,
}));
const cafeteriaId = "00000000-0000-0000-0000-000000000002";
const orderId = "00000000-0000-0000-0000-000000000001";
const statuses = new Map();
const confirmed = new Set();
const clientOrderId = "00000000-0000-0000-0000-000000000010";
const foreignClientOrderId = "00000000-0000-0000-0000-000000000011";
const unlinkedClientOrderId = "00000000-0000-0000-0000-000000000013";
const clientStatuses = new Map();
const json = (response, status, body) => {
  response.writeHead(status, {
    "Content-Type": "application/json",
    "X-Supabase-Api-Version": "2024-01-01",
  });
  response.end(JSON.stringify(body));
};
const user = (profile) => ({
  id: profile.id,
  email: profile.email,
  aud: "authenticated",
  role: "authenticated",
  email_confirmed_at:
    profile.email.startsWith("unverified") && !confirmed.has(profile.id)
      ? null
      : "2026-01-01T00:00:00Z",
  created_at: "2026-01-01T00:00:00Z",
  app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: { role: "WORKER" },
});
const encode = (value) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");
const token = (profile) =>
  `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: profile.id, aud: "authenticated", role: "authenticated", iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 })}.${encode("test-signature-only")}`;

function session(profile) {
  return {
    access_token: token(profile),
    token_type: "bearer",
    expires_in: 3600,
    refresh_token: "fixture-refresh-token",
    user: user(profile),
  };
}

createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://127.0.0.1:3101");
    if (url.pathname === "/health") return json(response, 200, { ok: true });
    if (
      ["/auth/v1/resend", "/auth/v1/recover"].includes(url.pathname) &&
      request.method === "POST"
    ) {
      for await (const chunk of request) {
        void chunk;
      }
      return json(response, 200, {});
    }
    if (url.pathname === "/auth/v1/verify" && request.method === "POST") {
      let raw = "";
      for await (const chunk of request) raw += chunk;
      const body = JSON.parse(raw),
        profile = fixtures.find(({ email }) => email === body.email);
      if (!profile || body.token !== "123456")
        return json(response, 400, {
          code: "otp_expired",
          msg: "Invalid fixture code",
        });
      confirmed.add(profile.id);
      statuses.set(profile.id, "PENDING");
      return json(response, 200, session(profile));
    }
    if (url.pathname === "/auth/v1/token" && request.method === "POST") {
      let raw = "";
      for await (const chunk of request) raw += chunk;
      const body = JSON.parse(raw);
      const profile = fixtures.find(({ email }) => email === body.email);
      if (!profile || body.password !== "UnaClave8")
        return json(response, 400, {
          code: "invalid_credentials",
          msg: "Invalid credentials",
        });
      if (!user(profile).email_confirmed_at)
        return json(response, 400, {
          code: "email_not_confirmed",
          msg: "Email not confirmed",
        });
      statuses.set(profile.id, "PENDING");
      clientStatuses.set(profile.id, "PENDING");
      return json(response, 200, session(profile));
    }
    const authorization = request.headers.authorization?.replace(
      /^Bearer /i,
      "",
    );
    let subject;
    try {
      subject = JSON.parse(
        Buffer.from(authorization.split(".")[1], "base64url").toString(),
      ).sub;
    } catch {
      /* No fixture session. */
    }
    const profile = fixtures.find(({ id }) => id === subject);
    if (!profile)
      return json(response, 401, {
        code: "session_not_found",
        msg: "No session",
      });
    if (url.pathname === "/auth/v1/user")
      return json(response, 200, user(profile));
    if (url.pathname === "/auth/v1/logout") return json(response, 200, {});
    if (url.pathname === "/rest/v1/rpc/current_auth_profile")
      return json(response, 200, profile);
    if (
      url.pathname.startsWith("/api/me/orders/") &&
      request.method === "PATCH"
    ) {
      if (
        !profile.active ||
        profile.roles.length !== 1 ||
        profile.roles[0] !== "CLIENT"
      )
        return json(response, 403, { message: "Forbidden provider-secret" });
      if (
        [foreignClientOrderId, unlinkedClientOrderId].some(
          (id) => url.pathname === `/api/me/orders/${id}/cancel`,
        )
      )
        return json(response, 404, {
          message: "Not found provider-secret",
        });
      if (url.pathname !== `/api/me/orders/${clientOrderId}/cancel`)
        return json(response, 404, { message: "Missing provider-secret" });
      if (clientStatuses.get(profile.id) !== "PENDING")
        return json(response, 409, {
          message: "Invalid state provider-secret",
        });
      clientStatuses.set(profile.id, "CANCELLED");
      return json(response, 200, {
        id: clientOrderId,
        status: "CANCELLED",
        cancellationDeadline: "2020-01-01T00:00:00Z",
        accessToken: "provider-secret",
      });
    }
    if (
      url.pathname === "/api/worker/context" ||
      url.pathname.startsWith("/api/orders")
    ) {
      if (
        !profile.active ||
        profile.assignments !== 1 ||
        profile.roles.length !== 1 ||
        !profile.roles.includes("WORKER") ||
        profile.roles.some((role) => ["ADMIN", "SUPER_ADMIN"].includes(role))
      )
        return json(response, 403, { message: "Forbidden" });
      if (url.pathname === "/api/worker/context")
        return json(response, 200, { cafeteriaId });
      if (
        request.method === "GET" &&
        url.searchParams.get("cafeteriaId") !== cafeteriaId
      )
        return json(response, 403, { message: "Other cafeteria" });
      if (request.method === "PATCH") {
        if (url.pathname !== `/api/orders/${orderId}/prepare`)
          return json(response, 404, {});
        statuses.set(profile.id, "PREPARING");
      }
      const order = {
        id: orderId,
        cafeteriaId,
        status: statuses.get(profile.id) || "PENDING",
        clientName: "Estudiante de prueba",
        clientDocument: "123456",
        total: 10000,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        items: [],
      };
      return json(response, 200, request.method === "GET" ? [order] : order);
    }
    return json(response, 404, {});
  } catch {
    return json(response, 500, { message: "Fixture error" });
  }
}).listen(3101, "127.0.0.1");

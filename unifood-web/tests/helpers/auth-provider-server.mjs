// Loopback-only provider/backend fixture for browser tests. Never used by the app runtime.
import { createServer } from "node:http";
import { randomUUID, createHash } from "node:crypto";
import { browserAvailabilityFixture } from "./availability-fixture.mjs";
import {
  workerHistoryFixture,
  workerHistoryPageFixture,
} from "./worker-history-fixture.mjs";
import { adminProfileBusinessFixture } from "./admin-profile-fixture.mjs";
import { adminCatalogFixture } from "./admin-catalog-fixture.mjs";
import { workerProfileBusinessFixture } from "./worker-profile-fixture.mjs";

const fixtures = Object.entries({
  client: ["CLIENT"],
  clientlong: ["CLIENT"],
  worker: ["WORKER"],
  unverifiedworker: ["WORKER"],
  unverifiedclient: ["CLIENT"],
  recoveryclient: ["CLIENT"],
  recoveryworker: ["WORKER"],
  recoveryadmin: ["ADMIN"],
  recoverysuperadmin: ["SUPER_ADMIN"],
  providerdown: ["CLIENT"],
  providerdisconnect: ["CLIENT"],
  backendunauthorized: ["WORKER"],
  backendforbidden: ["WORKER"],
  backendunavailable: ["WORKER"],
  backenddisconnect: ["WORKER"],
  admin: ["ADMIN"],
  adminother: ["ADMIN"],
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
  email:
    name === "clientlong"
      ? "estudiante.con.correo.institucional.extenso@universidad-de-ejemplo.example.invalid"
      : `${name}@example.invalid`,
  fullName:
    name === "clientlong"
      ? "MaríaAlejandraConUnNombreMuyLargoParaComprobarElAjusteDelContenido Torres Quintín"
      : roles.includes("WORKER")
        ? null
        : "Usuario de prueba",
  active: name !== "inactive",
  roles,
  assignments: name === "unassigned" ? 0 : name === "multiassigned" ? 2 : 1,
}));
const cafeteriaId = "00000000-0000-0000-0000-000000000002";
const orderId = "00000000-0000-0000-0000-000000000001";
const recoveryLinks = new Map();
const panelRecovery = {
  requestMode: null,
  updateMode: null,
  logoutMode: null,
  lastLink: null,
  requests: 0,
  exchanges: 0,
  updates: 0,
  businessReads: 0,
};
const statuses = new Map();
const confirmed = new Set();
const passwords = new Map();
const refreshTokens = new Map();
const failures = new Map();
const profileAudit = { directBusinessReads: 0, backendProfileReads: 0 };
const availabilityStates = new Map();
const availabilityAudit = { directBusinessReads: 0 };
const historyStates = new Map();
const operationalStates = new Map();
const workerProfileStates = new Map();
function workerProfileState(profile) {
  if (!workerProfileStates.has(profile.id))
    workerProfileStates.set(profile.id, {
      data: workerProfileBusinessFixture(),
      mode: null,
      gets: 0,
      inactive: false,
    });
  return workerProfileStates.get(profile.id);
}
const adminProfileStates = new Map();
const adminCatalogStates = new Map();
function adminCatalogState(profile) {
  if (!adminCatalogStates.has(profile.id))
    adminCatalogStates.set(profile.id, {
      data: adminCatalogFixture(profile.email.startsWith("adminother@")),
      mode: null,
      gets: 0,
      mutations: [],
      mutationMode: null,
    });
  return adminCatalogStates.get(profile.id);
}
function adminProfileState(profile) {
  if (!adminProfileStates.has(profile.id))
    adminProfileStates.set(profile.id, {
      data: adminProfileBusinessFixture(),
      mode: null,
      gets: 0,
      inactive: false,
    });
  return adminProfileStates.get(profile.id);
}
function historyState(profile) {
  if (!historyStates.has(profile.id))
    historyStates.set(profile.id, {
      data: workerHistoryFixture(),
      mode: null,
      gets: 0,
    });
  return historyStates.get(profile.id);
}
function availabilityState(profile) {
  if (!availabilityStates.has(profile.id))
    availabilityStates.set(profile.id, {
      data: browserAvailabilityFixture(),
      mode: null,
      gets: 0,
      puts: [],
    });
  return availabilityStates.get(profile.id);
}
function temporaryFailure(request, response, profile, scope) {
  const mode = failures.get(profile.id);
  if (
    !mode ||
    mode === "concurrent" ||
    mode === "backend-profile" ||
    (mode === "profile" && scope !== "profile")
  )
    return false;
  if (mode === "disconnect") request.socket.destroy();
  else json(response, 503, { message: "PRIVATE_PROVIDER_OUTAGE" });
  return true;
}
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
  const refreshToken = `fixture-refresh-${profile.id}`;
  refreshTokens.set(refreshToken, profile);
  return {
    access_token: token(profile),
    token_type: "bearer",
    expires_in: 3600,
    refresh_token: refreshToken,
    user: user(profile),
  };
}

createServer(async (request, response) => {
  try {
    const origin = request.headers.origin;
    if (
      [
        "http://localhost:3100",
        "http://127.0.0.1:3100",
        "http://[::1]:3100",
      ].includes(origin)
    ) {
      response.setHeader("Access-Control-Allow-Origin", origin);
      response.setHeader(
        "Access-Control-Allow-Headers",
        "authorization, apikey, content-type, x-client-info, x-supabase-api-version",
      );
      response.setHeader(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, OPTIONS",
      );
    }
    if (request.method === "OPTIONS") {
      response.writeHead(204);
      return response.end();
    }
    const url = new URL(request.url, "http://127.0.0.1:3101");
    if (url.pathname === "/__test/panel-recovery") {
      let input = {};
      if (request.method === "POST") {
        let raw = "";
        for await (const chunk of request) raw += chunk;
        input = JSON.parse(raw);
      }
      if (input.reset) {
        recoveryLinks.clear();
        Object.assign(panelRecovery, {
          requestMode: null,
          updateMode: null,
          logoutMode: null,
          lastLink: null,
          requests: 0,
          exchanges: 0,
          updates: 0,
          businessReads: 0,
        });
        for (const entry of fixtures.filter(
          (entry) =>
            entry.email.startsWith("recovery") &&
            !entry.email.startsWith("recoveryclient"),
        ))
          passwords.delete(entry.id);
      }
      for (const field of ["requestMode", "updateMode", "logoutMode"])
        if (Object.hasOwn(input, field)) panelRecovery[field] = input[field];
      if (input.expire && panelRecovery.lastLink)
        recoveryLinks.get(
          new URL(panelRecovery.lastLink).searchParams.get("code"),
        ).expired = true;
      return json(response, 200, panelRecovery);
    }
    if (url.pathname === "/health") return json(response, 200, { ok: true });
    if (url.pathname === "/__test/worker-profile") {
      let config;
      if (request.method === "POST") {
        let raw = "";
        for await (const chunk of request) raw += chunk;
        config = JSON.parse(raw);
      } else config = { email: url.searchParams.get("email") };
      const target = fixtures.find((entry) => entry.email === config.email);
      if (!target) return json(response, 400, {});
      if (config.reset) workerProfileStates.delete(target.id);
      const state = workerProfileState(target);
      if (Object.hasOwn(config, "mode")) state.mode = config.mode;
      if (Object.hasOwn(config, "inactive")) state.inactive = config.inactive;
      if (config.data) state.data = config.data;
      return json(response, 200, { gets: state.gets });
    }
    if (url.pathname === "/__test/admin-catalog") {
      let config;
      if (request.method === "POST") {
        let raw = "";
        for await (const chunk of request) raw += chunk;
        config = JSON.parse(raw);
      } else config = { email: url.searchParams.get("email") };
      const target = fixtures.find((entry) => entry.email === config.email);
      if (!target) return json(response, 400, {});
      if (config.reset) adminCatalogStates.delete(target.id);
      const state = adminCatalogState(target);
      if (Object.hasOwn(config, "mode")) state.mode = config.mode;
      if (Object.hasOwn(config, "mutationMode"))
        state.mutationMode = config.mutationMode;
      if (config.data) state.data = config.data;
      return json(response, 200, {
        gets: state.gets,
        mutations: state.mutations,
      });
    }
    if (url.pathname === "/__test/admin-profile") {
      let config;
      if (request.method === "POST") {
        let raw = "";
        for await (const chunk of request) raw += chunk;
        config = JSON.parse(raw);
      } else config = { email: url.searchParams.get("email") };
      const target = fixtures.find((entry) => entry.email === config.email);
      if (!target) return json(response, 400, {});
      if (config.reset) adminProfileStates.delete(target.id);
      const state = adminProfileState(target);
      if (Object.hasOwn(config, "mode")) state.mode = config.mode;
      if (Object.hasOwn(config, "inactive")) state.inactive = config.inactive;
      if (config.data) state.data = config.data;
      return json(response, 200, { gets: state.gets });
    }
    if (url.pathname === "/__test/worker-history") {
      let config;
      if (request.method === "POST") {
        let raw = "";
        for await (const chunk of request) raw += chunk;
        config = JSON.parse(raw);
      } else config = { email: url.searchParams.get("email") };
      const target = fixtures.find((entry) => entry.email === config.email);
      if (!target) return json(response, 400, {});
      if (config.reset) historyStates.delete(target.id);
      const state = historyState(target);
      if (Object.hasOwn(config, "mode")) state.mode = config.mode;
      if (config.data) state.data = config.data;
      return json(response, 200, { gets: state.gets });
    }
    if (url.pathname === "/__test/worker-orders" && request.method === "POST") {
      let raw = "";
      for await (const chunk of request) raw += chunk;
      const config = JSON.parse(raw),
        target = fixtures.find((entry) => entry.email === config.email);
      if (!target) return json(response, 400, {});
      if (config.reset) operationalStates.delete(target.id);
      if (config.data) operationalStates.set(target.id, config.data);
      return json(response, 200, {});
    }
    if (url.pathname === "/__test/availability") {
      if (request.method === "POST") {
        let raw = "";
        for await (const chunk of request) raw += chunk;
        const config = JSON.parse(raw);
        const target = fixtures.find((entry) => entry.email === config.email);
        if (!target) return json(response, 400, {});
        if (config.reset) availabilityStates.delete(target.id);
        const state = availabilityState(target);
        if (typeof config.active === "boolean")
          state.data.cafeteria.active = config.active;
        if (typeof config.open === "boolean")
          state.data.cafeteria.open = config.open;
        if (typeof config.available === "boolean")
          state.data.categories[1].items[0].available = config.available;
        if (Object.hasOwn(config, "mode")) state.mode = config.mode;
        return json(response, 200, { ok: true });
      }
      const target = fixtures.find(
        (entry) => entry.email === url.searchParams.get("email"),
      );
      if (!target) return json(response, 400, {});
      const state = availabilityState(target);
      return json(response, 200, {
        gets: state.gets,
        puts: state.puts,
        directBusinessReads: availabilityAudit.directBusinessReads,
      });
    }
    if (
      [
        "/rest/v1/lunches",
        "/rest/v1/cafeteria_daily_states",
        "/rest/v1/daily_item_availability",
      ].includes(url.pathname)
    ) {
      availabilityAudit.directBusinessReads++;
      return json(response, 403, {
        message: "Direct business access is disabled",
      });
    }
    if (url.pathname === "/__test/profile-audit" && request.method === "GET")
      return json(response, 200, profileAudit);
    // Model the post-010 permissions instead of granting fake business REST reads.
    if (
      [
        "/rest/v1/clients",
        "/rest/v1/institutions",
        "/rest/v1/users",
        "/rest/v1/cafeteria_users",
        "/rest/v1/cafeterias",
        "/rest/v1/sites",
      ].includes(url.pathname)
    ) {
      profileAudit.directBusinessReads++;
      return json(response, 403, {
        message: "Direct business access is disabled",
      });
    }
    if (url.pathname === "/__test/auth-failure" && request.method === "POST") {
      let raw = "";
      for await (const chunk of request) raw += chunk;
      const { email, mode } = JSON.parse(raw);
      const target = fixtures.find((fixture) => fixture.email === email);
      if (
        !target ||
        (mode !== null &&
          ![
            "503",
            "disconnect",
            "profile",
            "concurrent",
            "backend-profile",
          ].includes(mode))
      )
        return json(response, 400, {});
      if (mode === null) failures.delete(target.id);
      else failures.set(target.id, mode);
      return json(response, 200, { ok: true });
    }
    if (url.pathname === "/auth/v1/recover" && request.method === "POST") {
      let raw = "";
      for await (const chunk of request) raw += chunk;
      const body = JSON.parse(raw);
      // Legacy CLIENT recovery remains an OTP fixture. Panel uses real SDK PKCE.
      if (
        body.code_challenge &&
        url.searchParams.get("redirect_to") &&
        new URL(url.searchParams.get("redirect_to")).pathname ===
          "/panel/nueva-contrasena"
      ) {
        panelRecovery.requests++;
        if (panelRecovery.requestMode)
          return json(response, Number(panelRecovery.requestMode), {
            code:
              panelRecovery.requestMode === "429"
                ? "over_email_send_rate_limit"
                : "unexpected_failure",
            message: "PRIVATE_MAIL_DETAIL",
          });
        const profile = fixtures.find((entry) => entry.email === body.email);
        if (profile) {
          const code = randomUUID();
          const redirect = new URL(url.searchParams.get("redirect_to"));
          redirect.searchParams.set("code", code);
          recoveryLinks.set(code, {
            profile,
            challenge: body.code_challenge,
            method: body.code_challenge_method,
            used: false,
            expired: false,
          });
          panelRecovery.lastLink = redirect.href;
        }
      }
      return json(response, 200, {});
    }
    if (url.pathname === "/auth/v1/resend" && request.method === "POST") {
      for await (const chunk of request) void chunk;
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
      if (url.searchParams.get("grant_type") === "pkce") {
        panelRecovery.exchanges++;
        const link = recoveryLinks.get(body.auth_code);
        const challenge =
          typeof body.code_verifier === "string"
            ? createHash("sha256")
                .update(body.code_verifier)
                .digest("base64url")
            : null;
        if (
          !link ||
          link.used ||
          link.expired ||
          link.method !== "s256" ||
          challenge !== link.challenge
        )
          return json(response, 400, {
            code: "otp_expired",
            message: "PRIVATE_RECOVERY_DETAIL",
          });
        link.used = true;
        return json(response, 200, session(link.profile));
      }
      if (url.searchParams.get("grant_type") === "refresh_token") {
        const refreshProfile = refreshTokens.get(body.refresh_token);
        if (!refreshProfile)
          return json(response, 400, {
            code: "refresh_token_not_found",
            msg: "Invalid fixture refresh",
          });
        if (temporaryFailure(request, response, refreshProfile, "identity"))
          return;
        return json(response, 200, session(refreshProfile));
      }
      const profile = fixtures.find(({ email }) => email === body.email);
      if (profile?.email.startsWith("providerdown@"))
        return json(response, 503, { message: "PRIVATE_FIXTURE_DETAIL" });
      if (profile?.email.startsWith("providerdisconnect@"))
        return request.socket.destroy();
      if (
        !profile ||
        body.password !== (passwords.get(profile.id) || "UnaClave8")
      )
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
    if (url.pathname === "/auth/v1/user" && request.method === "PUT") {
      let raw = "";
      for await (const chunk of request) raw += chunk;
      const { password } = JSON.parse(raw);
      if (
        profile.email.startsWith("recovery") &&
        !profile.email.startsWith("recoveryclient")
      ) {
        panelRecovery.updates++;
        if (panelRecovery.updateMode)
          return json(
            response,
            panelRecovery.updateMode === "503" ? 503 : 422,
            {
              code:
                panelRecovery.updateMode === "503"
                  ? "unexpected_failure"
                  : panelRecovery.updateMode,
              message: "PRIVATE_UPDATE_DETAIL",
            },
          );
      }
      if (typeof password !== "string" || password.length < 8)
        return json(response, 400, {
          code: "weak_password",
          msg: "Invalid fixture password",
        });
      passwords.set(profile.id, password);
      return json(response, 200, user(profile));
    }
    if (
      url.pathname === "/auth/v1/user" &&
      temporaryFailure(request, response, profile, "identity")
    )
      return;
    if (url.pathname === "/auth/v1/user")
      return json(response, 200, user(profile));
    if (url.pathname === "/auth/v1/logout") {
      if (profile.email.startsWith("recovery") && panelRecovery.logoutMode)
        return json(response, 503, { message: "PRIVATE_LOGOUT_DETAIL" });
      return json(response, 200, {});
    }
    if (
      url.pathname === "/rest/v1/rpc/current_auth_profile" &&
      temporaryFailure(request, response, profile, "profile")
    )
      return;
    if (url.pathname === "/rest/v1/rpc/current_auth_profile") {
      panelRecovery.businessReads++;
      return json(
        response,
        200,
        profile.roles.includes("WORKER")
          ? {
              ...profile,
              active: profile.active && !workerProfileState(profile).inactive,
              email: "business-email-is-not-auth@example.invalid",
            }
          : profile.roles.includes("ADMIN")
            ? {
                ...profile,
                active: profile.active && !adminProfileState(profile).inactive,
                email: "business-email-is-not-auth@example.invalid",
              }
            : profile,
      );
    }
    if (url.pathname === "/api/worker/profile" && request.method === "GET") {
      const state = workerProfileState(profile);
      state.gets++;
      if (
        !profile.active ||
        state.inactive ||
        profile.assignments !== 1 ||
        profile.roles.length !== 1 ||
        profile.roles[0] !== "WORKER"
      )
        return json(response, 403, {
          code: "WORKER_PROFILE_FORBIDDEN",
          message: "PRIVATE",
        });
      if (["401", "403", "500", "503"].includes(state.mode)) {
        if (state.mode === "503") response.setHeader("Retry-After", "9");
        return json(response, Number(state.mode), {
          message: "PRIVATE_SQL_DETAIL",
        });
      }
      if (state.mode === "redirect") {
        response.writeHead(302, { location: "/api/me/profile" });
        return response.end();
      }
      return json(response, 200, state.data);
    }
    if (
      url.pathname.startsWith("/api/admin/catalog") &&
      ["POST", "PATCH"].includes(request.method)
    ) {
      const state = adminCatalogState(profile);
      if (
        !profile.active ||
        adminProfileState(profile).inactive ||
        profile.assignments !== 1 ||
        profile.roles.length !== 1 ||
        profile.roles[0] !== "ADMIN"
      )
        return json(response, 403, { code: "ADMIN_CATALOG_FORBIDDEN" });
      if (!adminProfileState(profile).data.cafeteria.active)
        return json(response, 403, {
          code: "ADMIN_CATALOG_CAFETERIA_INACTIVE",
        });
      let raw = "";
      for await (const chunk of request) raw += chunk;
      const body = JSON.parse(raw);
      state.mutations.push({ path: url.pathname, body });
      if (state.mutationMode === "503")
        return json(response, 503, { message: "PRIVATE" });
      if (state.mutationMode === "409")
        return json(response, 409, {
          code: "ADMIN_CATALOG_STALE_VERSION",
          message: "PRIVATE",
        });
      if (state.mutationMode === "slow")
        await new Promise((resolve) => setTimeout(resolve, 800));
      const isCreate =
        request.method === "POST" && url.pathname === "/api/admin/catalog";
      const id = url.pathname.split("/")[4];
      const existing = state.data.products.find((p) => p.id === id);
      if (!isCreate && !existing)
        return json(response, 404, { code: "ADMIN_CATALOG_PRODUCT_NOT_FOUND" });
      if (!isCreate && body.expectedVersion !== existing.version)
        return json(response, 409, { code: "ADMIN_CATALOG_STALE_VERSION" });
      const isStatus = url.pathname.endsWith("/status");
      if (
        !isStatus &&
        state.data.products.some((p) => p.id !== id && p.name === body.name)
      )
        return json(response, 409, { code: "ADMIN_CATALOG_DUPLICATE_NAME" });
      const result = isCreate
        ? {
            id: randomUUID(),
            ...body,
            active: true,
            imageUrl: null,
            version: "0",
          }
        : {
            ...existing,
            ...(isStatus
              ? { active: body.active }
              : {
                  name: body.name,
                  description: body.description,
                  price: body.price,
                  category: body.category,
                }),
            version: String(BigInt(existing.version) + 1n),
          };
      if (!isStatus)
        result.price = result.price.includes(".")
          ? result.price.split(".")[0] +
            "." +
            result.price.split(".")[1].padEnd(2, "0")
          : result.price + ".00";
      if (isCreate) state.data.products.push(result);
      else
        state.data.products = state.data.products.map((p) =>
          p.id === id ? result : p,
        );
      if (state.mutationMode === "disconnect-after-commit")
        return request.socket.destroy();
      return json(response, isCreate ? 201 : 200, result);
    }
    if (url.pathname === "/api/admin/catalog" && request.method === "GET") {
      const state = adminCatalogState(profile);
      state.gets++;
      if (
        !profile.active ||
        adminProfileState(profile).inactive ||
        profile.assignments !== 1 ||
        profile.roles.length !== 1 ||
        profile.roles[0] !== "ADMIN"
      )
        return json(response, 403, { message: "PRIVATE" });
      if (["401", "403", "500", "503"].includes(state.mode)) {
        if (state.mode === "503") response.setHeader("Retry-After", "9");
        return json(response, Number(state.mode), {
          message: "PRIVATE_SQL_DETAIL",
        });
      }
      return json(response, 200, state.data);
    }
    if (url.pathname === "/api/admin/profile" && request.method === "GET") {
      const state = adminProfileState(profile);
      state.gets++;
      if (
        !profile.active ||
        state.inactive ||
        profile.assignments !== 1 ||
        profile.roles.length !== 1 ||
        profile.roles[0] !== "ADMIN"
      )
        return json(response, 403, {
          code: "ADMIN_PROFILE_FORBIDDEN",
          message: "PRIVATE",
        });
      if (["401", "403", "500", "503"].includes(state.mode)) {
        if (state.mode === "503") response.setHeader("Retry-After", "9");
        return json(response, Number(state.mode), {
          message: "PRIVATE_SQL_DETAIL",
        });
      }
      if (state.mode === "redirect") {
        response.writeHead(302, { location: "/api/me/profile" });
        return response.end();
      }
      return json(response, 200, state.data);
    }
    if (url.pathname.startsWith("/api/worker/availability/today")) {
      if (
        !profile.active ||
        profile.assignments !== 1 ||
        profile.roles.length !== 1 ||
        profile.roles[0] !== "WORKER"
      )
        return json(response, 403, {
          code: "AVAILABILITY_FORBIDDEN",
          message: "PRIVATE",
        });
      const state = availabilityState(profile);
      if (request.method === "GET") {
        state.gets++;
        if (state.mode === "get503") {
          response.setHeader("Retry-After", "5");
          return json(response, 503, {
            code: "AVAILABILITY_TEMPORARILY_UNAVAILABLE",
            message: "PRIVATE",
          });
        }
        return json(response, 200, state.data);
      }
      if (request.method !== "PUT") return json(response, 405, {});
      let raw = "";
      for await (const chunk of request) raw += chunk;
      const body = JSON.parse(raw);
      const day = request.headers["x-business-date"];
      state.puts.push({ path: url.pathname, day, body });
      if (state.mode === "put503")
        return json(response, 503, {
          code: "AVAILABILITY_TEMPORARILY_UNAVAILABLE",
          message: "PRIVATE",
        });
      if (state.mode === "stale") {
        state.mode = null;
        state.data.businessDate = "2026-10-14";
        state.data.cafeteria.open = false;
        state.data.categories.forEach((group) =>
          group.items.forEach((item) => {
            item.available = false;
          }),
        );
      }
      if (day !== state.data.businessDate)
        return json(response, 409, {
          code: "AVAILABILITY_DAY_EXPIRED",
          message: "PRIVATE",
        });
      const cafeOperation = url.pathname.endsWith("/cafeteria-state");
      const id = url.pathname.split("/").at(-1);
      if (["iteminactive", "notfound"].includes(state.mode) && !cafeOperation) {
        const code =
          state.mode === "notfound"
            ? "AVAILABILITY_ITEM_NOT_FOUND"
            : "AVAILABILITY_ITEM_INACTIVE";
        state.mode = null;
        state.data.categories.forEach((group) => {
          group.items = group.items.filter((item) => item.id !== id);
        });
        return json(
          response,
          code === "AVAILABILITY_ITEM_NOT_FOUND" ? 404 : 409,
          { code, message: "PRIVATE" },
        );
      }
      if (state.mode === "cafinactive") {
        state.mode = null;
        state.data.cafeteria.active = false;
      }
      if (
        !state.data.cafeteria.active &&
        (body.available === true || body.open === true)
      )
        return json(response, 409, {
          code: "AVAILABILITY_CAFETERIA_INACTIVE",
          message: "PRIVATE",
        });
      if (cafeOperation) {
        state.data.cafeteria.open = body.open;
        return json(response, 200, {
          businessDate: state.data.businessDate,
          open: body.open,
        });
      }
      const item = state.data.categories
        .flatMap((group) => group.items)
        .find((entry) => entry.id === id);
      if (!item)
        return json(response, 404, {
          code: "AVAILABILITY_ITEM_NOT_FOUND",
          message: "PRIVATE",
        });
      item.available = body.available;
      return json(response, 200, {
        businessDate: state.data.businessDate,
        itemId: item.id,
        available: item.available,
      });
    }
    if (
      url.pathname === "/api/worker/orders/history" &&
      request.method === "GET"
    ) {
      if (
        !profile.active ||
        profile.assignments !== 1 ||
        profile.roles.length !== 1 ||
        profile.roles[0] !== "WORKER"
      )
        return json(response, 403, {
          code: "WORKER_HISTORY_FORBIDDEN",
          message: "PRIVATE",
        });
      const state = historyState(profile);
      state.gets++;
      if (state.mode === "503") {
        response.setHeader("Retry-After", "5");
        return json(response, 503, {
          code: "WORKER_HISTORY_TEMPORARILY_UNAVAILABLE",
          message: "PRIVATE_SQL_DETAIL",
        });
      }
      if (state.mode === "403" || state.mode === "401")
        return json(response, Number(state.mode), { message: "PRIVATE" });
      if (state.mode === "raw") return json(response, 200, state.data);
      try {
        return json(
          response,
          200,
          workerHistoryPageFixture(state.data, url.searchParams),
        );
      } catch {
        return json(response, 400, {
          code: "WORKER_HISTORY_INVALID_REQUEST",
          message: "PRIVATE",
        });
      }
    }
    if (url.pathname === "/api/me/profile" && request.method === "GET") {
      profileAudit.backendProfileReads++;
      if (
        !profile.active ||
        profile.roles.length !== 1 ||
        profile.roles[0] !== "CLIENT"
      )
        return json(response, 403, { code: "FORBIDDEN" });
      if (failures.get(profile.id) === "backend-profile")
        return json(response, 503, {
          code: "CLIENT_PROFILE_TEMPORARILY_UNAVAILABLE",
          message: "PRIVATE_BACKEND_PROFILE_DETAIL",
        });
      return json(response, 200, {
        document: "1234567890",
        phone: null,
        institution: "Universidad de prueba",
      });
    }
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
      if (failures.get(profile.id) === "concurrent")
        return json(response, 409, {
          code: "ORDER_CONCURRENT_MODIFICATION",
          message: "PRIVATE_JPA_LOCK_DETAIL",
          version: 55,
        });
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
      if (url.pathname === "/api/worker/context") {
        const failure = {
          backendunauthorized: 401,
          backendforbidden: 403,
          backendunavailable: 503,
        }[profile.email.split("@")[0]];
        if (failure)
          return json(response, failure, { message: "PRIVATE_FIXTURE_DETAIL" });
        if (profile.email.startsWith("backenddisconnect@"))
          return request.socket.destroy();
        return json(response, 200, { cafeteriaId });
      }
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
      if (request.method === "GET") {
        const configured = operationalStates.get(profile.id);
        const businessDate =
          configured?.businessDate ||
          new Date(Date.now() - 5 * 3600000).toISOString().slice(0, 10);
        const start = Date.parse(businessDate + "T05:00:00Z"),
          end = start + 86400000;
        response.setHeader("X-Business-Date", businessDate);
        response.setHeader(
          "X-Next-Business-Date-At",
          new Date(end).toISOString(),
        );
        const orders = (configured?.orders || [order]).filter(
          (entry) =>
            ["PENDING", "PREPARING", "READY", "CALLED"].includes(
              entry.status,
            ) ||
            (entry.status === "DELIVERED" &&
              entry.deliveredAt &&
              Date.parse(entry.deliveredAt) >= start &&
              Date.parse(entry.deliveredAt) < end),
        );
        return json(response, 200, orders);
      }
      return json(response, 200, order);
    }
    return json(response, 404, {});
  } catch {
    return json(response, 500, { message: "Fixture error" });
  }
}).listen(3101, "127.0.0.1");

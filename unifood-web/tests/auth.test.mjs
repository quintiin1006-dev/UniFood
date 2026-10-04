import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { createAuthDatabase } from "./helpers/auth-database.mjs";

function load(file, mocks = {}, cache = new Map()) {
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
        return load(`${name.slice(2)}.ts`, mocks, cache);
      if (name.startsWith("."))
        return load(
          path.resolve(path.dirname(resolved), `${name}.ts`),
          mocks,
          cache,
        );
      throw new Error(`Unexpected import: ${name}`);
    },
    mod,
    mod.exports,
  );
  return mod.exports;
}

const validation = load("features/auth/validation.ts");
test("password, email, document and role boundaries", () => {
  for (const invalid of [
    "short",
    "password1",
    "PASSWORD1",
    "Password",
    "Aa1".repeat(44),
  ])
    assert.equal(validation.validPassword(invalid), false);
  assert.equal(validation.validPassword("UnaClave8"), true);
  assert.equal(validation.validEmail("persona@ustavillavo.edu.co"), true);
  assert.equal(validation.validEmail("persona@university@evil.com"), false);
  assert.equal(validation.validDocument("12345"), true);
  assert.equal(validation.validDocument("12.345"), false);
  assert.equal(
    validation.normalizeIdentifier(
      " MARIA ",
      validation.DEFAULT_USERNAME_DOMAIN,
    ),
    "maria@ustavillavo.edu.co",
  );
  assert.equal(
    validation.destination({ active: true, roles: ["CLIENT"] }),
    "/cuenta",
  );
  assert.equal(
    validation.isWorker({ active: false, roles: ["SUPER_ADMIN"] }),
    false,
  );
});

test("cookies are HttpOnly; remember disabled creates a browser-session cookie", () => {
  const config = load("features/auth/server/config.ts");
  assert.equal(config.sessionCookieOptions(false).httpOnly, true);
  assert.equal(config.sessionCookieOptions(false).maxAge, undefined);
  assert.equal(config.sessionCookieOptions(true).maxAge, 2592000);
  assert.equal(config.sessionCookieOptions(true, true).maxAge, 0);
});

function fixture(rpc) {
  const calls = [];
  const jar = {
    set: (...args) => calls.push(["cookie", ...args]),
    delete: () => {},
  };
  const state = {
    providerError: null,
    institutional: true,
    user: { id: "student" },
    profile: { active: true, roles: ["CLIENT"] },
  };
  const result = async (name, input) => {
    calls.push([name, input]);
    return { data: {}, error: state.providerError };
  };
  const client = {
    auth: {
      signInWithPassword: (input) => result("login", input),
      signUp: (input) => result("signup", input),
      verifyOtp: (input) => result("verify", input),
      resend: (input) => result("resend", input),
      resetPasswordForEmail: (input) => result("recover", input),
      updateUser: (input) => result("reset", input),
      signOut: (input) => result("logout", input),
      getUser: async () => ({ data: { user: state.user } }),
    },
    rpc: async (name, params) => {
      calls.push([name, params]);
      return rpc
        ? rpc(name, params)
        : {
            data:
              name === "is_institutional_email"
                ? state.institutional
                : state.profile,
          };
    },
  };
  const route = load("app/api/auth/[action]/route.ts", {
    "next/headers": { cookies: async () => jar },
    "@/features/auth/server/client": {
      authClient: async (remember) => {
        calls.push(["client", remember]);
        return client;
      },
    },
    "@/features/auth/server/config": {
      authConfig: () => true,
      rememberCookie: "remember",
      sessionCookieOptions: (remember) => ({
        httpOnly: true,
        ...(remember ? { maxAge: 1 } : {}),
      }),
    },
  });
  const post = (action, body = {}, origin = "http://localhost:3000") =>
    route.POST(
      new Request(`http://localhost:3000/api/auth/${action}`, {
        method: "POST",
        headers: { origin, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ action }) },
    );
  return { calls, state, post };
}

test("auth rejects cross-origin requests before touching Supabase", async () => {
  const { post, calls } = fixture();
  assert.equal((await post("login", {}, "https://evil.example")).status, 403);
  assert.equal(calls.length, 0);
});

test("same origin follows the Host header, not the bound dev hostname", () => {
  const at = (url, origin, headers = {}) =>
    validation.sameOrigin(
      new Request(url, { method: "POST", headers: { origin, ...headers } }),
    );
  // Next builds request.url from `--hostname ::`, so it disagrees with the browser's Host.
  assert.equal(
    at("http://[::]:3000/api/auth/login", "http://localhost:3000", {
      host: "localhost:3000",
    }),
    true,
  );
  assert.equal(
    at("http://[::]:3000/api/auth/login", "http://192.168.56.1:3000", {
      host: "192.168.56.1:3000",
    }),
    true,
  );
  assert.equal(
    at("http://[::]:3000/api/auth/login", "https://evil.example", {
      host: "localhost:3000",
    }),
    false,
  );
  assert.equal(
    at("http://[::]:3000/api/auth/login", "http://localhost:3001", {
      host: "localhost:3000",
    }),
    false,
  );
  assert.equal(
    at("http://[::]:3000/api/auth/login", "http://localhost:3000", {
      host: "localhost:3000",
      "x-forwarded-host": "unifood.app",
      "x-forwarded-proto": "https",
    }),
    false,
  );
  assert.equal(
    at("http://[::]:3000/api/auth/login", "https://unifood.app", {
      host: "localhost:3000",
      "x-forwarded-host": "unifood.app",
      "x-forwarded-proto": "https",
    }),
    true,
  );
  assert.equal(
    at("http://localhost:3000/api/auth/login", "http://localhost:3000"),
    true,
  );
  assert.equal(
    validation.sameOrigin(
      new Request("http://localhost:3000/api/auth/login", { method: "POST" }),
    ),
    false,
  );
});

test("registration validates institution and password and never trusts submitted roles", async () => {
  const { post, calls, state } = fixture();
  const body = {
    email: "student@ustavillavo.edu.co",
    fullName: "María Pérez",
    document: "12345678",
    password: "UnaClave8",
    role: "SUPER_ADMIN",
  };
  state.institutional = false;
  assert.equal((await post("register", body)).status, 400);
  state.institutional = true;
  assert.equal(
    (await post("register", { ...body, password: "weak" })).status,
    400,
  );
  assert.ok(!calls.some(([name]) => name === "signup"));
  assert.equal((await post("register", body)).status, 200);
  const submitted = calls.find(([name]) => name === "signup")[1];
  assert.deepEqual(submitted.options.data, {
    full_name: "María Pérez",
    document: "12345678",
    registration_type: "student",
  });
});

test("login preserves provider failures and routes users using database roles", async () => {
  const { post, state, calls } = fixture();
  state.providerError = { code: "invalid_credentials", status: 400 };
  assert.equal(
    (await post("login", { email: "maria", password: "incorrect" })).status,
    401,
  );
  state.providerError = { code: "email_not_confirmed" };
  assert.equal(
    (
      await (
        await post("login", { email: "maria", password: "UnaClave8" })
      ).json()
    ).code,
    "email_not_confirmed",
  );
  state.providerError = null;
  let response = await post("login", {
    email: "maria",
    password: "UnaClave8",
    remember: false,
  });
  assert.deepEqual(await response.json(), { redirect: "/cuenta" });
  assert.equal(calls.find(([name]) => name === "cookie")[3].maxAge, undefined);
  state.profile.roles = ["WORKER"];
  response = await post("login", {
    email: "worker",
    password: "UnaClave8",
    remember: true,
  });
  assert.deepEqual(await response.json(), { redirect: "/worker" });
  for (const [roles, target] of [
    [["ADMIN"], "/admin"],
    [["SUPER_ADMIN"], "/super-admin"],
  ]) {
    state.profile.roles = roles;
    for (const action of ["login", "verify"]) {
      response = await post(action, {
        email: "admin",
        password: "UnaClave8",
        code: "123456",
        role: "WORKER",
      });
      assert.deepEqual(await response.json(), { redirect: target });
    }
  }
  state.profile.active = false;
  assert.equal(
    (await post("login", { email: "worker", password: "UnaClave8" })).status,
    403,
  );
  assert.ok(calls.some(([name]) => name === "logout"));
});

test("login and verification reject zero, multiple, duplicate and unknown business roles", async () => {
  for (const roles of [
    [],
    ["UNKNOWN"],
    ["CLIENT", "CLIENT"],
    ["CLIENT", "WORKER"],
    ["CLIENT", "ADMIN"],
    ["CLIENT", "SUPER_ADMIN"],
    ["WORKER", "ADMIN"],
    ["WORKER", "SUPER_ADMIN"],
    ["ADMIN", "SUPER_ADMIN"],
    null,
    "CLIENT",
  ]) {
    for (const action of ["login", "verify"]) {
      const { post, state, calls } = fixture();
      state.profile.roles = roles;
      const response = await post(action, {
        email: "fixture",
        password: "UnaClave8",
        code: "123456",
      });
      assert.equal(response.status, 403);
      const body = await response.json();
      assert.equal(body.redirect, undefined);
      assert.ok(calls.some(([name]) => name === "logout"));
    }
  }
});

test("OTP failures do not authenticate and password reset requires a verified session", async () => {
  const { post, state, calls } = fixture();
  assert.equal(
    (await post("verify", { email: "maria", code: "123" })).status,
    400,
  );
  assert.ok(!calls.some(([name]) => name === "verify"));
  state.providerError = { code: "otp_expired" };
  assert.equal(
    (await post("verify", { email: "maria", code: "123456" })).status,
    400,
  );
  state.providerError = null;
  assert.deepEqual(
    await (
      await post("verify", { email: "maria", code: "123456", recovery: true })
    ).json(),
    { ok: true },
  );
  assert.equal(calls.at(-1)[1].type, "recovery");
  state.user = null;
  assert.equal((await post("reset", { password: "NuevaClave8" })).status, 401);
  assert.ok(!calls.some(([name]) => name === "reset"));
  state.user = { id: "student" };
  assert.equal((await post("reset", { password: "NuevaClave8" })).status, 200);
  assert.ok(
    calls.some(
      ([name, input]) => name === "logout" && input.scope === "global",
    ),
  );
});

test("orders proxy blocks anonymous users, students and cross-origin changes", async () => {
  let auth = null;
  const route = load("app/api/orders/[[...path]]/route.ts", {
    "@/features/auth/server/session": { getAuth: async () => auth },
  });
  const get = () =>
    route.GET(new Request("http://localhost:3000/api/orders"), {
      params: Promise.resolve({}),
    });
  assert.equal((await get()).status, 401);
  auth = {
    profile: { active: true, roles: ["CLIENT"] },
    accessToken: "student",
  };
  assert.equal((await get()).status, 403);
  auth.profile.roles = ["WORKER"];
  const response = await route.PATCH(
    new Request("http://localhost:3000/api/orders", {
      method: "PATCH",
      headers: { origin: "https://evil.example" },
    }),
    {
      params: Promise.resolve({
        path: ["00000000-0000-0000-0000-000000000001", "prepare"],
      }),
    },
  );
  assert.equal(response.status, 403);
});

test("registration API uses PostgreSQL domain validation and preserves each recipient", async (t) => {
  const db = await createAuthDatabase();
  t.after(() => db.close());
  const { post, calls } = fixture(async (name, { email }) => {
    assert.equal(name, "is_institutional_email");
    return {
      data: (
        await db.query("SELECT public.is_institutional_email($1) AS allowed", [
          email,
        ])
      ).rows[0].allowed,
    };
  });
  const details = {
    fullName: "María Pérez",
    document: "123456789",
    password: "UnaClave8",
  };
  for (const domain of ["ustavillavo.edu.co", "ustavillavicencio.edu.co"]) {
    const email = `  MARIA@${domain.toUpperCase()}  `;
    assert.equal((await post("institution", { email })).status, 200);
    assert.equal((await post("register", { ...details, email })).status, 200);
    assert.equal(
      calls.findLast(([name]) => name === "signup")[1].email,
      `maria@${domain}`,
    );
  }
  const signupCount = calls.filter(([name]) => name === "signup").length;
  for (const email of [
    "maria",
    "maria@gmail.com",
    "maria@usantotomas.edu.co",
    "maria@ustavillavicencio.edu.co.evil.com",
    "maria@sub.ustavillavo.edu.co",
    "maria@@ustavillavo.edu.co",
  ]) {
    for (const action of ["institution", "register"]) {
      assert.equal(
        (await post(action, { ...details, email })).status,
        400,
        `${action}: ${email}`,
      );
    }
  }
  assert.equal(calls.filter(([name]) => name === "signup").length, signupCount);
  await db.exec("UPDATE public.institutions SET is_active = false");
  for (const domain of ["ustavillavo.edu.co", "ustavillavicencio.edu.co"]) {
    assert.equal(
      (await post("register", { ...details, email: `maria@${domain}` })).status,
      400,
    );
  }
});

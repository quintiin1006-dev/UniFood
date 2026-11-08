import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";
import { createAuthDatabase } from "./helpers/auth-database.mjs";

const nodeRequire = createRequire(import.meta.url);

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
      if (name.startsWith("node:")) return nodeRequire(name);
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

test("full identifiers retain their domain and validation enforces exact length limits", () => {
  assert.equal(
    validation.normalizeIdentifier(
      " PERSONA@EXAMPLE.INVALID ",
      "ustavillavo.edu.co",
    ),
    "persona@example.invalid",
  );
  assert.equal(
    validation.normalizeIdentifier(" PERSONA ", "example.invalid"),
    "persona@example.invalid",
  );
  const email = "a".repeat(242) + "@example.com";
  assert.equal(email.length, 254);
  assert.equal(validation.validEmail(email), true);
  assert.equal(validation.validEmail("a" + email), false);
  for (const value of [
    "",
    " a@example.com",
    "a@example.com ",
    "a@",
    "@example.com",
    "a@@example.com",
  ])
    assert.equal(validation.validEmail(value), false);
  for (const [value, accepted] of [
    ["Aa12345", false],
    ["Aa123456", true],
    ["Aa1" + "b".repeat(125), true],
    ["Aa1" + "b".repeat(126), false],
  ])
    assert.equal(validation.validPassword(value), accepted);
});

function fixture(rpc) {
  const calls = [];
  const jar = {
    set: (...args) => calls.push(["cookie", ...args]),
    delete: (...args) => calls.push(["delete-cookie", ...args]),
  };
  const state = {
    onCookiesWritten: null,
    signOutError: null,
    throwOnSignOut: false,
    rpcThrow: false,
    providerError: null,
    institutional: true,
    user: { id: "student" },
    userError: null,
    profile: { active: true, roles: ["CLIENT"] },
    clientType: "STUDENT",
    // pending_registration(): null answers { pending: false }.
    pending: null,
    pendingError: null,
    updateError: null,
    othersError: null,
    completeError: null,
    signupData: {},
  };
  const result = async (name, input) => {
    if (["login", "verify"].includes(name) && !state.providerError) {
      state.onCookiesWritten?.(["fixture-session.0", "fixture-session.1"]);
      jar.set("fixture-session.0", "test-session", {});
    }
    calls.push([name, input]);
    if (name === "logout" && state.throwOnSignOut)
      throw new Error("Provider unavailable");
    if (name === "logout" && input?.scope === "others" && state.othersError)
      return { error: state.othersError };
    if (name === "logout" && state.signOutError)
      return { error: state.signOutError };
    if (name === "reset" && state.updateError)
      return { data: {}, error: state.updateError };
    if (name === "signup")
      return { data: state.signupData, error: state.providerError };
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
      getUser: async () => ({
        data: { user: state.user },
        error: state.userError,
      }),
    },
    rpc: async (name, params) => {
      calls.push([name, params]);
      if (state.rpcThrow && name === "current_auth_profile")
        throw new Error("Profile unavailable");
      if (rpc) return rpc(name, params);
      if (name === "registration_rules")
        return {
          data: state.institutional
            ? { allowed: true, clientType: state.clientType }
            : { allowed: false },
        };
      if (name === "pending_registration")
        return state.pendingError
          ? { data: null, error: state.pendingError }
          : { data: state.pending ?? { pending: false } };
      if (name === "complete_registration") {
        if (state.completeError)
          return { data: null, error: state.completeError };
        state.pending = null;
        state.profile = { active: true, roles: ["CLIENT"] };
        return { data: null, error: null };
      }
      return { data: state.profile };
    },
  };
  const route = load("app/api/auth/[action]/route.ts", {
    "next/headers": { cookies: async () => jar },
    "@/features/auth/server/client": {
      clearAuthCookies: async (names = []) => {
        for (const name of names) jar.delete(name);
        jar.delete("remember");
      },
      authClient: async (remember, onCookiesWritten) => {
        state.onCookiesWritten = onCookiesWritten;
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

const pendingStudent = {
  pending: true,
  emailConfirmed: true,
  clientType: "STUDENT",
  codeRequired: true,
  minCodeLength: 7,
  maxCodeLength: 7,
};

test("step 1 signs up with a server-generated password that never leaves the server", async () => {
  const { post, calls, state } = fixture();
  const body = {
    email: "student@ustavillavo.edu.co",
    // The browser cannot choose these: step 1 ignores them.
    fullName: "María Pérez",
    code: "1234567",
    password: "BrowserChose8",
    role: "SUPER_ADMIN",
  };
  state.institutional = false;
  const denied = await post("register", body);
  assert.equal(denied.status, 400);
  assert.equal((await denied.json()).code, "REGISTRATION_DOMAIN_NOT_ALLOWED");
  assert.ok(!calls.some(([name]) => name === "signup"));
  state.institutional = true;

  const passwords = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await post("register", body);
    const text = await response.text();
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(text), { ok: true });
    const submitted = calls.findLast(([name]) => name === "signup")[1];
    // Only email and password: no name, code or metadata.
    assert.deepEqual(Object.keys(submitted).sort(), ["email", "password"]);
    assert.notEqual(submitted.password, body.password);
    assert.ok(submitted.password.length >= 43);
    assert.match(submitted.password, /[a-z]/);
    assert.match(submitted.password, /[A-Z]/);
    assert.match(submitted.password, /[0-9]/);
    assert.equal(text.includes(submitted.password), false);
    passwords.push(submitted.password);
  }
  assert.equal(new Set(passwords).size, 3);
  // Nothing written to a cookie carries it either.
  for (const call of calls.filter(([name]) => name === "cookie"))
    for (const password of passwords)
      assert.equal(JSON.stringify(call).includes(password), false);
});

test("step 1 gives the same answer whether or not the email had an account", async () => {
  for (const providerError of [
    null,
    { code: "user_already_exists", status: 422 },
    { code: "email_exists", status: 422 },
  ]) {
    const { post, state } = fixture();
    state.providerError = providerError;
    const response = await post("register", {
      email: "student@ustavillavo.edu.co",
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
  }
  const { post, state } = fixture();
  state.providerError = { code: "over_email_send_rate_limit", status: 429 };
  const limited = await post("register", {
    email: "student@ustavillavo.edu.co",
  });
  assert.equal(limited.status, 429);
  assert.match((await limited.json()).message, /Demasiados intentos/);
});

test("rules answers domain facts only and rejects addresses outside the rule", async () => {
  const { post, calls, state } = fixture();
  state.clientType = "STAFF";
  assert.deepEqual(
    await (
      await post("rules", { email: "Profe@USTAVILLAVICENCIO.edu.co" })
    ).json(),
    { allowed: true, clientType: "STAFF" },
  );
  assert.deepEqual(
    calls.findLast(([name]) => name === "registration_rules")[1],
    {
      email: "profe@ustavillavicencio.edu.co",
    },
  );
  const before = calls.length;
  for (const email of [
    "ana+x@ustavillavo.edu.co",
    "a..b@ustavillavo.edu.co",
    ".ana@ustavillavo.edu.co",
    "ana@",
    "",
  ]) {
    const response = await post("rules", { email });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { allowed: false });
    assert.equal(
      (await post("register", { email })).status,
      400,
      `register ${email}`,
    );
  }
  // Rejected before any provider or database call.
  assert.equal(
    calls
      .slice(before)
      .some(([name]) => ["registration_rules", "signup"].includes(name)),
    false,
  );
});

const completeBody = {
  fullName: "María Pérez",
  code: "1234567",
  privacy: true,
  password: "NuevaClave9",
};

test("step 2 updates the password, closes other sessions, then completes", async () => {
  const { post, calls, state } = fixture();
  state.pending = pendingStudent;
  state.profile = { active: false, roles: [] };
  const response = await post("complete", completeBody);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { redirect: "/cuenta" });
  const order = calls
    .map(([name, input]) =>
      name === "logout" ? `logout:${input.scope}` : name,
    )
    .filter((name) =>
      ["reset", "logout:others", "complete_registration"].includes(name),
    );
  assert.deepEqual(order, ["reset", "logout:others", "complete_registration"]);
  assert.deepEqual(calls.find(([name]) => name === "reset")[1], {
    password: "NuevaClave9",
  });
  assert.deepEqual(
    calls.find(([name]) => name === "complete_registration")[1],
    {
      full_name: "María Pérez",
      institutional_code: "1234567",
      privacy_accepted: true,
    },
  );
  // The session stays: no global or local sign-out, no cookie deletion.
  assert.ok(
    !calls.some(
      ([name, input]) =>
        name === "delete-cookie" ||
        (name === "logout" && input.scope !== "others"),
    ),
  );
});

test("step 2 stops before completing when the password or the sign-out fails", async () => {
  for (const failure of ["updateError", "othersError"]) {
    const { post, calls, state } = fixture();
    state.pending = pendingStudent;
    state[failure] = { status: 500, message: "PRIVATE_PROVIDER_DETAIL" };
    const response = await post("complete", completeBody);
    assert.equal(response.status, 502);
    assert.equal(
      JSON.stringify(await response.json()).includes("PRIVATE"),
      false,
    );
    assert.ok(!calls.some(([name]) => name === "complete_registration"));
    assert.ok(!calls.some(([name]) => name === "delete-cookie"));
  }
});

test("a failed step 2 keeps the session and can be retried without a new code", async () => {
  const { post, calls, state } = fixture();
  state.pending = pendingStudent;
  state.profile = { active: false, roles: [] };
  state.completeError = {
    code: "23505",
    message: "REGISTRATION_CODE_UNAVAILABLE",
  };
  const failed = await post("complete", completeBody);
  assert.equal(failed.status, 409);
  assert.equal((await failed.json()).code, "REGISTRATION_CODE_UNAVAILABLE");
  assert.ok(!calls.some(([name]) => name === "delete-cookie"));

  // Same password again: Auth answers same_password, which is not an error here.
  state.completeError = null;
  state.updateError = { code: "same_password", status: 422 };
  const retried = await post("complete", { ...completeBody, code: "7654321" });
  assert.equal(retried.status, 200);
  assert.deepEqual(await retried.json(), { redirect: "/cuenta" });
  assert.ok(!calls.some(([name]) => name === "verify"));
  assert.equal(
    calls.filter(([name]) => name === "complete_registration").length,
    2,
  );
});

test("step 2 maps every registration error to a safe Spanish message", async () => {
  const expected = {
    REGISTRATION_DOMAIN_NOT_ALLOWED: 400,
    REGISTRATION_NOT_AUTHENTICATED: 401,
    REGISTRATION_NOT_PENDING: 409,
    REGISTRATION_OTP_SESSION_REQUIRED: 403,
    REGISTRATION_EMAIL_NOT_CONFIRMED: 403,
    REGISTRATION_ACCOUNT_DISABLED: 403,
    REGISTRATION_PASSWORD_CHANGE_REQUIRED: 409,
    REGISTRATION_PRIVACY_REQUIRED: 400,
    REGISTRATION_INVALID_NAME: 400,
    REGISTRATION_INVALID_CODE: 400,
    REGISTRATION_CODE_UNAVAILABLE: 409,
  };
  const messages = new Set();
  for (const [code, status] of Object.entries(expected)) {
    const { post, state } = fixture();
    state.pending = pendingStudent;
    state.completeError = {
      code: "P0001",
      message: code,
      details: "PRIVATE_DATABASE_DETAIL",
    };
    const response = await post("complete", completeBody);
    const body = await response.json();
    assert.equal(response.status, status, code);
    assert.equal(body.code, code);
    assert.match(body.message, /[áéíóúñ]|\.$/);
    assert.equal(body.message.includes("REGISTRATION_"), false);
    assert.equal(JSON.stringify(body).includes("PRIVATE"), false);
    messages.add(body.message);
  }
  assert.equal(messages.size, Object.keys(expected).length);
  // Only the code-in-use message talks about an existing code.
  for (const message of messages)
    if (!message.startsWith("Ese código institucional ya está registrado"))
      assert.equal(/ya está registrad/.test(message), false, message);

  const { post, state } = fixture();
  state.pending = pendingStudent;
  state.completeError = { message: "PRIVATE_UNKNOWN_DETAIL" };
  const unknown = await post("complete", completeBody);
  assert.equal(unknown.status, 502);
  assert.equal(JSON.stringify(await unknown.json()).includes("PRIVATE"), false);
});

test("step 2 validates its input on the server before calling Supabase", async () => {
  const staff = {
    ...pendingStudent,
    clientType: "STAFF",
    codeRequired: false,
    minCodeLength: 5,
    maxCodeLength: 12,
  };
  for (const [pending, body, code] of [
    [pendingStudent, { fullName: "AB" }, "REGISTRATION_INVALID_NAME"],
    [pendingStudent, { privacy: false }, "REGISTRATION_PRIVACY_REQUIRED"],
    [pendingStudent, { privacy: "true" }, "REGISTRATION_PRIVACY_REQUIRED"],
    [pendingStudent, { code: "" }, "REGISTRATION_INVALID_CODE"],
    [pendingStudent, { code: "123456" }, "REGISTRATION_INVALID_CODE"],
    [pendingStudent, { code: "12345a7" }, "REGISTRATION_INVALID_CODE"],
    [staff, { code: "1234" }, "REGISTRATION_INVALID_CODE"],
    [
      { ...pendingStudent, emailConfirmed: false },
      {},
      "REGISTRATION_EMAIL_NOT_CONFIRMED",
    ],
    [null, {}, "REGISTRATION_NOT_PENDING"],
  ]) {
    const { post, calls, state } = fixture();
    state.pending = pending;
    const response = await post("complete", { ...completeBody, ...body });
    assert.equal((await response.json()).code, code, JSON.stringify(body));
    assert.ok(
      !calls.some(([name]) =>
        ["reset", "complete_registration"].includes(name),
      ),
    );
  }
  // Staff without a code is valid, and is sent as null.
  const { post, calls, state } = fixture();
  state.pending = staff;
  assert.equal(
    (await post("complete", { ...completeBody, code: "" })).status,
    200,
  );
  assert.equal(
    calls.find(([name]) => name === "complete_registration")[1]
      .institutional_code,
    null,
  );

  const weak = fixture();
  weak.state.pending = pendingStudent;
  assert.equal(
    (await weak.post("complete", { ...completeBody, password: "corta" }))
      .status,
    400,
  );
  const anonymous = fixture();
  anonymous.state.user = null;
  assert.equal(
    (await (await anonymous.post("complete", completeBody)).json()).code,
    "REGISTRATION_NOT_AUTHENTICATED",
  );
});

test("a pending registration is sent to step 2 after verify, login or recovery", async () => {
  for (const [action, body] of [
    ["verify", { email: "ana@ustavillavo.edu.co", code: "123456" }],
    ["login", { email: "ana@ustavillavo.edu.co", password: "NuevaClave9" }],
    [
      "verify",
      { email: "ana@ustavillavo.edu.co", code: "123456", recovery: true },
    ],
  ]) {
    const { post, calls, state } = fixture();
    state.pending = pendingStudent;
    state.profile = { active: false, roles: [] };
    const response = await post(action, body);
    assert.equal(response.status, 200, action);
    assert.deepEqual(await response.json(), {
      redirect: "/registro/completar",
    });
    // The code session is kept for step 2.
    assert.ok(
      !calls.some(([name]) => ["logout", "delete-cookie"].includes(name)),
    );
  }
  // Without a pending registration an inactive account is still rejected.
  const { post, state, calls } = fixture();
  state.profile = { active: false, roles: [] };
  assert.equal(
    (
      await post("login", {
        email: "ana@ustavillavo.edu.co",
        password: "NuevaClave9",
      })
    ).status,
    403,
  );
  assert.ok(calls.some(([name]) => name === "logout"));
  // The panel never offers step 2.
  const panel = fixture();
  panel.state.pending = pendingStudent;
  panel.state.profile = { active: false, roles: [] };
  assert.equal(
    (
      await panel.post("login", {
        entrypoint: "panel",
        email: "ana",
        password: "NuevaClave9",
      })
    ).status,
    403,
  );
  // An error reading the pending registration denies, it never grants step 2.
  const broken = fixture();
  broken.state.pendingError = { message: "PRIVATE" };
  broken.state.profile = { active: false, roles: [] };
  assert.equal(
    (
      await broken.post("login", {
        email: "ana@ustavillavo.edu.co",
        password: "NuevaClave9",
      })
    ).status,
    403,
  );
});

test("requireAuth sends a pending registration to step 2 and nobody else", async () => {
  const redirect = (location) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { location });
  };
  const sessionFor = (user, rpcData) =>
    load("features/auth/server/session.ts", {
      react: { cache: (fn) => fn },
      "next/navigation": { redirect, unstable_rethrow: () => {} },
      "./client": {
        authClient: async () => ({
          auth: {
            getUser: async () => ({ data: { user }, error: null }),
            getSession: async () => ({ data: { session: null }, error: null }),
          },
          rpc: async (name) => ({ data: rpcData[name] ?? null, error: null }),
        }),
      },
      "./config": { authConfig: () => true },
    });
  const pendingSession = sessionFor(
    { id: "ana", email_confirmed_at: "2026-11-08T00:00:00Z" },
    {
      current_auth_profile: { active: false, roles: [] },
      pending_registration: pendingStudent,
    },
  );
  await assert.rejects(
    pendingSession.requireAuth(),
    (error) => error.location === "/registro/completar",
  );
  await assert.rejects(
    pendingSession.requireAuth("panel"),
    (error) => error.location === "/panel/login",
  );
  for (const [user, data] of [
    [null, {}],
    [
      { id: "x", email_confirmed_at: "2026-11-08T00:00:00Z" },
      { pending_registration: { pending: false } },
    ],
    [
      { id: "x", email_confirmed_at: "2026-11-08T00:00:00Z" },
      { pending_registration: { pending: true } },
    ],
  ])
    await assert.rejects(
      sessionFor(user, data).requireAuth(),
      (error) => error.location === "/login",
    );
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
  assert.equal(
    calls.find(([name, key]) => name === "cookie" && key === "remember")[3]
      .maxAge,
    undefined,
  );
  state.profile.roles = ["WORKER"];
  response = await post("login", {
    email: "worker",
    entrypoint: "panel",
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
        entrypoint: "panel",
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

test("password reset preserves its verified recovery cookies during a temporary provider failure", async () => {
  const { post, state, calls } = fixture();
  state.userError = {
    name: "AuthRetryableFetchError",
    status: 503,
    message: "PRIVATE_PROVIDER_DETAIL",
  };
  const response = await post("reset", { password: "UnaClave8" });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal((await response.json()).code, "AUTH_TEMPORARILY_UNAVAILABLE");
  assert.ok(
    !calls.some(([name]) =>
      ["delete-cookie", "reset", "logout"].includes(name),
    ),
  );
});

test("provider rate limits and service failures return safe statuses without establishing remember", async () => {
  for (const [providerError, status] of [
    [{ status: 429, code: "rate_limit_exceeded" }, 429],
    [{ status: 503, message: "PRIVATE_FIXTURE_DETAIL" }, 502],
    [{ name: "AuthRetryableFetchError", status: 0 }, 502],
    [
      {
        status: 400,
        code: "unknown_provider_error",
        message: "PRIVATE_FIXTURE_DETAIL",
      },
      400,
    ],
  ]) {
    const { post, state, calls } = fixture();
    state.providerError = providerError;
    const response = await post("login", {
      email: "fixture",
      password: "SyntheticPassword8",
      remember: true,
    });
    assert.equal(response.status, status);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const body = await response.json();
    assert.equal(typeof body.message, "string");
    assert.equal(body.message.includes("PRIVATE_FIXTURE_DETAIL"), false);
    assert.equal(body.redirect, undefined);
    assert.equal(
      calls.some(([name]) => name === "cookie"),
      false,
    );
  }
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

test("four roles by two entrypoints uses only current database roles and establishes remember last", async () => {
  for (const [role, target] of [
    ["CLIENT", "/cuenta"],
    ["WORKER", "/worker"],
    ["ADMIN", "/admin"],
    ["SUPER_ADMIN", "/super-admin"],
  ]) {
    for (const entrypoint of ["client", "panel"]) {
      for (const action of ["login", "verify"]) {
        const { post, state, calls } = fixture();
        state.profile.roles = [role];
        const accepted = (role === "CLIENT") === (entrypoint === "client");
        const response = await post(action, {
          entrypoint,
          email: "fixture",
          password: "UnaClave8",
          code: "123456",
          remember: true,
          role: "SUPER_ADMIN",
          user_metadata: { role: "SUPER_ADMIN" },
        });
        assert.equal(response.status, accepted ? 200 : 403);
        const payload = await response.json();
        if (action === "verify")
          assert.ok(
            !calls.some(([name]) => name === "login"),
            "OTP must not require password authentication again",
          );
        const rememberWrites = calls.filter(
          ([name, key]) => name === "cookie" && key === "remember",
        );
        if (accepted) {
          assert.deepEqual(payload, { redirect: target });
          assert.equal(rememberWrites.length, 1);
          assert.ok(
            calls.findIndex(
              ([name, key]) => name === "cookie" && key === "remember",
            ) > calls.findIndex(([name]) => name === "current_auth_profile"),
          );
          assert.ok(!calls.some(([name]) => name === "logout"));
        } else {
          assert.equal(payload.redirect, undefined);
          assert.equal(rememberWrites.length, 0);
          assert.ok(
            calls.some(
              ([name, input]) => name === "logout" && input.scope === "local",
            ),
          );
          assert.deepEqual(
            calls
              .filter(([name]) => name === "delete-cookie")
              .map(([, key]) => key)
              .sort(),
            ["fixture-session.0", "fixture-session.1", "remember"],
          );
        }
      }
    }
  }
});

test("invalid entrypoints are rejected before provider calls; student registration stays client-only", async () => {
  for (const entrypoint of [
    null,
    "worker",
    "ADMIN",
    "https://evil.invalid",
    ["panel"],
    {},
    true,
  ]) {
    const { post, calls } = fixture();
    assert.equal(
      (
        await post("login", {
          entrypoint,
          email: "worker",
          password: "UnaClave8",
        })
      ).status,
      400,
    );
    assert.equal(calls.length, 0);
  }
  for (const action of ["register", "rules", "complete"]) {
    const { post, calls } = fixture();
    assert.equal(
      (
        await post(action, {
          entrypoint: "panel",
          email: "student@ustavillavo.edu.co",
        })
      ).status,
      400,
    );
    assert.equal(calls.length, 0);
  }
});

test("profile errors and failed provider signOut cannot retain attempt cookies or remember", async () => {
  for (const mode of [
    "invalid",
    "signOutError",
    "signOutThrows",
    "rpcThrows",
  ]) {
    const { post, state, calls } = fixture();
    state.profile.roles = ["CLIENT"];
    state.signOutError = mode === "signOutError" ? { status: 500 } : null;
    state.throwOnSignOut = mode === "signOutThrows";
    state.rpcThrow = mode === "rpcThrows";
    if (mode === "invalid") state.profile.roles = [];
    const response = await post("login", {
      entrypoint: "panel",
      email: "fixture",
      password: "UnaClave8",
      remember: true,
    });
    assert.equal(response.status, mode === "rpcThrows" ? 502 : 403);
    assert.equal(
      calls.filter(([name, key]) => name === "cookie" && key === "remember")
        .length,
      0,
    );
    assert.deepEqual(
      calls
        .filter(([name]) => name === "delete-cookie")
        .map(([, key]) => key)
        .sort(),
      ["fixture-session.0", "fixture-session.1", "remember"],
    );
  }
});

test("logout keeps contextual destinations, CLIENT retains OTP and panel legacy reset is closed", async () => {
  for (const entrypoint of ["client", "panel"]) {
    const { post, calls } = fixture();
    const target = entrypoint === "client" ? "/login" : "/panel/login";
    assert.deepEqual(await (await post("logout", { entrypoint })).json(), {
      redirect: target,
    });
    if (entrypoint === "panel") {
      calls.length = 0;
      for (const action of ["recover", "reset", "verify", "resend"]) {
        const response = await post(action, {
          entrypoint,
          email: "fixture",
          recovery: true,
          code: "123456",
          password: "NuevaClave8",
        });
        assert.equal(response.status, 400);
        assert.equal(
          (await response.json()).code,
          "PANEL_RECOVERY_LINK_REQUIRED",
        );
      }
      assert.equal(calls.length, 0);
      continue;
    }
    assert.deepEqual(
      await (
        await post("reset", { entrypoint, password: "NuevaClave8" })
      ).json(),
      { redirect: target },
    );
    assert.ok(
      calls.some(
        ([name, input]) => name === "logout" && input.scope === "global",
      ),
    );
    calls.length = 0;
    assert.deepEqual(
      await (
        await post("verify", {
          entrypoint,
          email: "fixture",
          code: "123456",
          recovery: true,
        })
      ).json(),
      { ok: true },
    );
    assert.ok(
      !calls.some(([name]) =>
        ["logout", "delete-cookie", "current_auth_profile"].includes(name),
      ),
    );
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
  assert.equal(
    calls.findLast(([name]) => name === "verify")[1].type,
    "recovery",
  );
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
  // registration_rules() from the real 018, as the anon key would call it.
  const { post, calls } = fixture(async (name, { email }) => {
    assert.equal(name, "registration_rules");
    await db.exec("SET ROLE anon");
    try {
      return {
        data: (
          await db.query("SELECT public.registration_rules($1) AS rules", [
            email,
          ])
        ).rows[0].rules,
      };
    } finally {
      await db.exec("RESET ROLE");
    }
  });
  for (const [domain, clientType] of [
    ["ustavillavo.edu.co", "STUDENT"],
    ["ustavillavicencio.edu.co", "STAFF"],
  ]) {
    const email = `  MARIA@${domain.toUpperCase()}  `;
    assert.deepEqual(await (await post("rules", { email })).json(), {
      allowed: true,
      clientType,
    });
    assert.equal((await post("register", { email })).status, 200);
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
    "maria+x@ustavillavo.edu.co",
  ]) {
    assert.deepEqual(
      await (await post("rules", { email })).json(),
      { allowed: false },
      `rules: ${email}`,
    );
    assert.equal((await post("register", { email })).status, 400, email);
  }
  assert.equal(calls.filter(([name]) => name === "signup").length, signupCount);
  await db.exec("UPDATE public.institutions SET is_active = false");
  for (const domain of ["ustavillavo.edu.co", "ustavillavicencio.edu.co"]) {
    assert.equal(
      (await post("register", { email: `maria@${domain}` })).status,
      400,
    );
  }
});

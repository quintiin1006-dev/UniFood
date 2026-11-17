import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

// Every module receives an isolated environment, never the developer's variables.
function load(file, environment = {}, mocks = {}, cache = new Map()) {
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
  new Function("require", "module", "exports", "process", source)(
    (name) => {
      if (name in mocks) return mocks[name];
      if (name === "server-only") return {};
      if (name === "node:os") return { networkInterfaces: () => ({}) };
      const dependency = name.startsWith("@/")
        ? path.resolve(`${name.slice(2)}.ts`)
        : path.resolve(path.dirname(resolved), `${name}.ts`);
      return load(dependency, environment, mocks, cache);
    },
    mod,
    mod.exports,
    { env: environment, cwd: () => process.cwd() },
  );
  return mod.exports;
}

const config = load("config/environment.ts");
const deployment = {
  NODE_ENV: "production",
  API_URL: "http://backend.test:8080",
  SUPABASE_URL: "https://auth.test",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_configuration_only",
};

test("staging and production require every critical variable, including blank values", () => {
  for (const variable of [
    "API_URL",
    "SUPABASE_URL",
    "SUPABASE_PUBLISHABLE_KEY",
  ]) {
    for (const value of [undefined, "", "  "]) {
      assert.throws(
        () => config.validateEnvironment({ ...deployment, [variable]: value }),
        new RegExp(`${variable} is required`),
      );
    }
  }
  assert.doesNotThrow(() => config.validateEnvironment(deployment));
});

test("local uses an explicit API URL and can preview the UI without Supabase", () => {
  const local = { NODE_ENV: "development", API_URL: "http://localhost:8080/" };
  assert.equal(config.readApiUrl(local), "http://localhost:8080");
  assert.equal(config.readAuthConfig(local), null);
  assert.doesNotThrow(() => config.validateEnvironment(local));
  assert.throws(
    () => config.validateEnvironment({ NODE_ENV: "development" }),
    /API_URL is required/,
  );
  assert.throws(
    () =>
      config.readAuthConfig({ ...local, SUPABASE_URL: "https://auth.test" }),
    /SUPABASE_PUBLISHABLE_KEY is required/,
  );
  assert.throws(
    () =>
      config.readAuthConfig({
        ...local,
        SUPABASE_PUBLISHABLE_KEY: deployment.SUPABASE_PUBLISHABLE_KEY,
      }),
    /SUPABASE_URL is required/,
  );
});

test("API_URL never falls back to a public variable or localhost", () => {
  assert.throws(
    () => config.readApiUrl({ NEXT_PUBLIC_API_URL: "http://localhost:8080" }),
    /API_URL is required/,
  );
  assert.equal(
    config.readApiUrl({
      ...deployment,
      NEXT_PUBLIC_API_URL: "https://wrong-environment.test",
    }),
    deployment.API_URL,
  );
});

test("invalid URL configuration is rejected without exposing its value", () => {
  for (const variable of ["API_URL", "SUPABASE_URL"]) {
    for (const value of [
      "not-a-url-secret",
      "ftp://secret.test",
      "https://user:password-secret@host.test",
      "https://host.test?key=query-secret",
      "https://host.test#fragment-secret",
    ]) {
      assert.throws(
        () => config.validateEnvironment({ ...deployment, [variable]: value }),
        (error) =>
          error.message.includes(variable) &&
          !error.message.includes(value) &&
          !error.message.includes("secret"),
      );
    }
  }
});

test("configuration accepts non-empty keys without interpreting their format", () => {
  for (const key of [
    "opaque-public-key-test-only",
    "test.key.with.arbitrary.parts",
    "clave-de-prueba-🔑",
    "  opaque-public-key-test-only  ",
  ]) {
    assert.equal(
      config.readAuthConfig({ ...deployment, SUPABASE_PUBLISHABLE_KEY: key })
        .key,
      key.trim(),
    );
  }
});

test("Next configuration fails before build/start and instrumentation rechecks runtime values", () => {
  assert.throws(
    () => load("next.config.ts", { NODE_ENV: "production" }),
    /API_URL is required/,
  );
  assert.equal(
    load("next.config.ts", deployment).default.turbopack.root,
    process.cwd(),
  );
  const environment = { ...deployment };
  const instrumentation = load("instrumentation.ts", environment);
  assert.doesNotThrow(() => instrumentation.register());
  delete environment.SUPABASE_PUBLISHABLE_KEY;
  assert.throws(
    () => instrumentation.register(),
    /SUPABASE_PUBLISHABLE_KEY is required/,
  );
});

test("server accessors and auth configuration use only their isolated server environment", () => {
  const server = load("config/server.ts", deployment);
  assert.equal(server.serverApiUrl(), deployment.API_URL);
  assert.deepEqual(
    load("features/auth/server/config.ts", deployment).authConfig(),
    {
      url: deployment.SUPABASE_URL,
      key: deployment.SUPABASE_PUBLISHABLE_KEY,
    },
  );
});

test("orders BFF rejects missing API_URL before forwarding even when NEXT_PUBLIC_API_URL exists", async () => {
  const route = load(
    "app/api/orders/[[...path]]/route.ts",
    {
      NEXT_PUBLIC_API_URL: "http://localhost:8080",
    },
    {
      "@/features/auth/server/session": {
        getAuth: async () => ({
          profile: { active: true, roles: ["WORKER"] },
          accessToken: "test-token",
        }),
      },
    },
  );
  await assert.rejects(
    route.GET(new Request("http://localhost:3100/api/orders"), {
      params: Promise.resolve({}),
    }),
    /API_URL is required/,
  );
});

// Staging guard (web). Fake references only: real project references never enter the repository.
const expectedRef = "stgrefabcdefghijklmn";
const otherRef = "prdrefzyxwvutsrqponm";
const guardedKey = "sb_publishable_test_configuration_only";
const guarded = (supabaseUrl, expected = expectedRef) => ({
  NODE_ENV: "production",
  API_URL: "https://backend.test",
  SUPABASE_URL: supabaseUrl,
  SUPABASE_PUBLISHABLE_KEY: guardedKey,
  UNIFOOD_EXPECTED_PROJECT_REF: expected,
});

test("staging guard accepts the expected project host, with or without trailing slash", () => {
  assert.doesNotThrow(() =>
    config.validateEnvironment(guarded(`https://${expectedRef}.supabase.co`)),
  );
  assert.doesNotThrow(() =>
    config.validateEnvironment(guarded(`https://${expectedRef}.supabase.co/`)),
  );
  assert.equal(
    config.readAuthConfig(guarded(`https://${expectedRef}.supabase.co/`)).url,
    `https://${expectedRef}.supabase.co`,
  );
});

test("staging guard rejects another project reference and names only references", () => {
  const error = (() => {
    try {
      config.validateEnvironment(guarded(`https://${otherRef}.supabase.co`));
    } catch (caught) {
      return caught;
    }
    return null;
  })();
  assert.ok(error, "another project must be refused");
  assert.match(error.message, new RegExp(otherRef));
  assert.match(error.message, new RegExp(expectedRef));
  assert.doesNotMatch(error.message, new RegExp(guardedKey));
});

test("staging guard rejects variants of the expected host", () => {
  const variants = [
    `https://${expectedRef.toUpperCase()}.supabase.co`,
    `https://${expectedRef}.supabase.co:443`,
    `https://${expectedRef}.supabase.co/auth/v1`,
    `https://${expectedRef}.supabase.co/?x=1`,
    `https://${expectedRef}.supabase.co.evil.test`,
    `https://${expectedRef}.example.test`,
    `https://evil.test/${expectedRef}.supabase.co`,
    `https://user@${expectedRef}.supabase.co`,
    `http://${expectedRef}.supabase.co`,
    `https://${expectedRef}.supabase.co#frag`,
  ];
  for (const url of variants) {
    assert.throws(
      () => config.validateEnvironment(guarded(url)),
      /SUPABASE_URL/,
      `must reject ${url}`,
    );
  }
});

test("staging guard rejects a malformed URL and a malformed expected reference", () => {
  assert.throws(
    () => config.validateEnvironment(guarded("not a url")),
    /SUPABASE_URL must be an absolute HTTP\(S\) URL/,
  );
  assert.throws(
    () =>
      config.validateEnvironment(
        guarded(`https://${expectedRef}.supabase.co`, "UPPERCASE"),
      ),
    /UNIFOOD_EXPECTED_PROJECT_REF must be a 20-character/,
  );
  assert.throws(
    () =>
      config.validateEnvironment(
        guarded(`https://${expectedRef}.supabase.co`, "short"),
      ),
    /UNIFOOD_EXPECTED_PROJECT_REF must be a 20-character/,
  );
});

test("without UNIFOOD_EXPECTED_PROJECT_REF, or with it blank, nothing changes", () => {
  const unset = guarded(`https://${otherRef}.supabase.co`);
  delete unset.UNIFOOD_EXPECTED_PROJECT_REF;
  assert.doesNotThrow(() => config.validateEnvironment(unset));
  const blank = guarded(`https://${otherRef}.supabase.co`, "   ");
  assert.doesNotThrow(() => config.validateEnvironment(blank));
  assert.doesNotThrow(() =>
    config.validateEnvironment({
      ...deployment,
      SUPABASE_URL: "https://auth.test",
    }),
  );
});

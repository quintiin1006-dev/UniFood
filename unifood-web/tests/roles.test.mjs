import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const redirect = (location) => {
  throw Object.assign(new Error("redirect"), { location });
};
const uiMocks = {
  "next/navigation": { redirect },
  "next/link": {
    default: ({ children, ...props }) => createElement("a", props, children),
  },
  "lucide-react": { BadgeCheck: () => null },
  "@/features/auth/components/Brand": {
    default: () => null,
    Waves: () => null,
  },
  "@/features/auth/components/LogoutButton": {
    default: () => createElement("button", {}, "Cerrar sesión"),
  },
  "@/features/auth/components/AuthScreen": {
    default: ({ entrypoint, initialMode }) =>
      createElement(
        "div",
        { "data-entrypoint": entrypoint, "data-mode": initialMode },
        "Auth form",
      ),
  },
  "@/components/worker/WorkerDashboard": {
    default: () => createElement("div", {}, "Worker dashboard"),
  },
};

function load(
  file,
  mocks = {},
  fetchMock = () => {
    throw new Error("Unexpected network request");
  },
  cache = new Map(),
) {
  const resolved = path.resolve(file);
  if (cache.has(resolved)) return cache.get(resolved).exports;
  const mod = { exports: {} };
  cache.set(resolved, mod);
  const source = ts.transpileModule(fs.readFileSync(resolved, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  new Function("require", "module", "exports", "fetch", source)(
    (name) => {
      if (name in mocks) return mocks[name];
      if (name === "react/jsx-runtime") return require(name);
      if (name.endsWith(".module.css")) return { default: {} };
      if (name === "./Brand")
        return uiMocks["@/features/auth/components/Brand"];
      if (name === "./LogoutButton")
        return uiMocks["@/features/auth/components/LogoutButton"];
      const dependency = name.startsWith("@/")
        ? path.resolve(name.slice(2))
        : path.resolve(path.dirname(resolved), name);
      const extension = fs.existsSync(`${dependency}.tsx`) ? ".tsx" : ".ts";
      return load(`${dependency}${extension}`, mocks, fetchMock, cache);
    },
    mod,
    mod.exports,
    fetchMock,
  );
  return mod.exports;
}

const validation = load("features/auth/validation.ts");
const profile = (roles, active = true) => ({
  id: "test-user",
  email: "test@example.invalid",
  fullName: "Prueba",
  active,
  roles,
});
const cases = [
  ["CLIENT", ["CLIENT"], "/cuenta", false],
  ["WORKER", ["WORKER"], "/worker", true],
  ["ADMIN", ["ADMIN"], "/admin", false],
  ["SUPER_ADMIN", ["SUPER_ADMIN"], "/super-admin", false],
  ["WORKER + ADMIN", ["WORKER", "ADMIN"], "/login", false],
  ["WORKER + SUPER_ADMIN", ["WORKER", "SUPER_ADMIN"], "/login", false],
  ["CLIENT + WORKER", ["CLIENT", "WORKER"], "/login", false],
  ["CLIENT + ADMIN", ["CLIENT", "ADMIN"], "/login", false],
  ["CLIENT + SUPER_ADMIN", ["CLIENT", "SUPER_ADMIN"], "/login", false],
  ["ADMIN + SUPER_ADMIN", ["ADMIN", "SUPER_ADMIN"], "/login", false],
  ["all roles", ["CLIENT", "WORKER", "ADMIN", "SUPER_ADMIN"], "/login", false],
  ["no roles", [], "/login", false],
  ["unknown role", ["UNKNOWN"], "/login", false],
];

test("role predicates and destinations separate operations from administration", () => {
  for (const [label, roles, destination, worker] of cases) {
    const current = profile(roles);
    assert.equal(validation.destination(current), destination, label);
    assert.equal(validation.isWorker(current), worker, label);
    const valid =
      roles.length === 1 &&
      ["CLIENT", "WORKER", "ADMIN", "SUPER_ADMIN"].includes(roles[0]);
    assert.equal(validation.hasValidBusinessRole(current), valid, label);
    assert.equal(
      validation.isAdmin(current),
      valid && roles.includes("ADMIN"),
      label,
    );
    assert.equal(
      validation.isSuperAdmin(current),
      valid && roles.includes("SUPER_ADMIN"),
      label,
    );
    assert.equal(
      validation.isClient(current),
      valid && roles.includes("CLIENT"),
      label,
    );
    const inactive = profile(roles, false);
    for (const predicate of ["isWorker", "isAdmin", "isSuperAdmin", "isClient"])
      assert.equal(validation[predicate](inactive), false, label);
    assert.equal(validation.destination(inactive), "/login");
  }
  assert.equal(validation.destination(null), "/login");
});

function pages(current) {
  return {
    ...uiMocks,
    "@/features/auth/server/session": {
      getAuth: async () =>
        validation.hasValidBusinessRole(current) ? { profile: current } : null,
      requireAuth: async (entrypoint = "client") => {
        if (!validation.hasValidBusinessRole(current))
          redirect(validation.loginPath(entrypoint));
        return { profile: current };
      },
    },
  };
}

test("worker page only renders for active operational workers", async () => {
  for (const [, roles, destination, worker] of cases) {
    const page = load("app/worker/page.tsx", pages(profile(roles))).default;
    if (worker)
      assert.match(renderToStaticMarkup(await page()), /Worker dashboard/);
    else
      await assert.rejects(
        page(),
        (error) =>
          error.location ===
          (validation.hasValidBusinessRole(profile(roles))
            ? destination
            : "/panel/login"),
      );
  }
  for (const current of [null, profile(["WORKER"], false)]) {
    await assert.rejects(
      load("app/worker/page.tsx", pages(current)).default(),
      (error) => error.location === "/panel/login",
    );
  }
});

test("account page never offers the worker panel to administrative roles", async () => {
  for (const [, roles, destination] of cases) {
    const page = load("app/cuenta/page.tsx", pages(profile(roles))).default;
    if (
      !validation.hasValidBusinessRole(profile(roles)) ||
      !roles.includes("CLIENT")
    )
      await assert.rejects(page(), (error) => error.location === destination);
    else
      assert.equal(
        renderToStaticMarkup(await page()).includes('href="/worker"'),
        false,
      );
  }
});

test("administrative placeholders enforce explicit active roles and provide no operations", async () => {
  for (const [file, role, heading] of [
    ["app/admin/page.tsx", "ADMIN", "Administración de cafetería"],
    ["app/super-admin/page.tsx", "SUPER_ADMIN", "Administración global"],
  ]) {
    for (const [, roles, destination] of cases) {
      const page = load(file, pages(profile(roles))).default;
      if (
        validation.hasValidBusinessRole(profile(roles)) &&
        roles.includes(role)
      ) {
        const html = renderToStaticMarkup(await page());
        assert.ok(html.includes(heading));
        assert.match(html, /Cerrar sesión/);
        assert.ok(!html.includes("/worker"));
      } else
        await assert.rejects(
          page(),
          (error) =>
            error.location ===
            (validation.hasValidBusinessRole(profile(roles))
              ? destination
              : "/panel/login"),
        );
    }
    for (const current of [null, profile([role], false)])
      await assert.rejects(
        load(file, pages(current)).default(),
        (error) => error.location === "/panel/login",
      );
  }
});

test("root opens the panel; existing sessions leave either login and registration for their actual destination", async () => {
  assert.throws(
    () => load("app/page.tsx", uiMocks).default(),
    (error) => error.location === "/panel/login",
  );
  for (const file of [
    "app/login/page.tsx",
    "app/panel/login/page.tsx",
    "app/registro/page.tsx",
  ]) {
    for (const [, roles, target] of cases.slice(0, 4)) {
      await assert.rejects(
        load(file, pages(profile(roles))).default(),
        (error) => error.location === target,
      );
    }
    for (const current of [
      null,
      profile([], true),
      profile(["UNKNOWN"]),
      profile(["WORKER"], false),
    ]) {
      const html = renderToStaticMarkup(
        await load(file, pages(current)).default(),
      );
      assert.match(
        html,
        file.includes("/panel/")
          ? /data-entrypoint="panel"/
          : /data-entrypoint="client"/,
      );
    }
  }
});

test("recovery validates context without redirecting an authenticated temporary session", async () => {
  const mocks = {
    ...pages(profile(["WORKER"])),
    "next/navigation": {
      redirect,
      notFound: () => {
        throw new Error("NOT_FOUND");
      },
    },
  };
  const page = load("app/recuperar-contrasena/page.tsx", mocks).default;
  for (const entrypoint of ["client", "panel", undefined]) {
    const html = renderToStaticMarkup(
      await page({ searchParams: Promise.resolve({ entrypoint }) }),
    );
    assert.match(
      html,
      new RegExp('data-entrypoint="' + (entrypoint ?? "client") + '"'),
    );
    assert.match(html, /data-mode="recover"/);
  }
  for (const entrypoint of [
    "worker",
    ["panel", "client"],
    null,
    "https://evil.invalid",
  ]) {
    await assert.rejects(
      page({ searchParams: Promise.resolve({ entrypoint }) }),
      /NOT_FOUND/,
    );
  }
});

test("BFF denies every operational route for non-workers and administrative combinations", async () => {
  let auth;
  const forwarded = [];
  const route = load(
    "app/api/orders/[[...path]]/route.ts",
    {
      "@/features/auth/server/session": { getAuth: async () => auth },
      "@/config/server": { serverApiUrl: () => "http://backend.test:8080" },
    },
    async (url, options) => {
      forwarded.push([String(url), options]);
      if (String(url).endsWith("/api/worker/context"))
        return Response.json({
          cafeteriaId: "00000000-0000-0000-0000-000000000002",
        });
      return Response.json([]);
    },
  );
  const orderId = "00000000-0000-0000-0000-000000000001";
  const operations = [
    [],
    ...["prepare", "ready", "call", "deliver", "cancel"].map((action) => [
      orderId,
      action,
    ]),
  ];
  for (const current of [
    null,
    profile(["WORKER"], false),
    ...cases.map(([, roles]) => profile(roles)),
  ]) {
    auth = current ? { profile: current, accessToken: "verified-token" } : null;
    const allowed = current && validation.isWorker(current);
    forwarded.length = 0;
    for (const operation of operations) {
      const method = operation.length ? "PATCH" : "GET";
      const response = await route[method](
        new Request(
          `http://localhost:3100/api/orders${operation.length ? `/${operation.join("/")}` : "?cafeteriaId=assigned"}`,
          {
            method,
            headers: {
              origin: "http://localhost:3100",
              authorization: "Bearer forged-worker",
            },
          },
        ),
        { params: Promise.resolve({ path: operation }) },
      );
      assert.equal(response.status, allowed ? 200 : current ? 403 : 401);
    }
    assert.equal(forwarded.length, allowed ? operations.length + 1 : 0);
    for (const [url, options] of forwarded) {
      assert.ok(
        url.startsWith("http://backend.test:8080/api/orders") ||
          url === "http://backend.test:8080/api/worker/context",
      );
      assert.equal(
        options.headers.get("authorization"),
        "Bearer verified-token",
      );
    }
  }
});

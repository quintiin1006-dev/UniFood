import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { availabilityLoader } from "./helpers/load-availability.mjs";
import { adminProfileFixture } from "./helpers/admin-profile-fixture.mjs";

const load = availabilityLoader();
const { AdminProfileStore } = load("features/admin-profile/state.ts");
const { AdminProfileError } = load("features/admin-profile/errors.ts");
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};

test("profile store clears old context, exposes loading and recovers after a temporary failure", async () => {
  let failed = false;
  const store = new AdminProfileStore({
    get: async () => {
      if (failed) throw new AdminProfileError(503);
      return adminProfileFixture();
    },
  });
  assert.equal(store.getSnapshot().loading, true);
  await store.refresh();
  assert.deepEqual(store.getSnapshot().data, adminProfileFixture());
  failed = true;
  const refreshing = store.refresh();
  assert.equal(store.getSnapshot().data, null);
  await refreshing;
  assert.equal(store.getSnapshot().error.status, 503);
  failed = false;
  await store.refresh();
  assert.equal(store.getSnapshot().error, null);
  assert.equal(store.getSnapshot().data.role, "ADMIN");
});

test("obsolete requests and disposed responses cannot repopulate an ADMIN context", async () => {
  const first = deferred(),
    second = deferred();
  const requests = [first, second];
  const store = new AdminProfileStore({ get: () => requests.shift().promise });
  const old = store.refresh(),
    current = store.refresh();
  second.resolve({
    ...adminProfileFixture(),
    email: "current@example.invalid",
  });
  await current;
  first.resolve(adminProfileFixture());
  await old;
  assert.equal(store.getSnapshot().data.email, "current@example.invalid");
  const pending = deferred();
  const disposed = new AdminProfileStore({ get: () => pending.promise });
  const reading = disposed.refresh();
  disposed.dispose();
  pending.resolve(adminProfileFixture());
  await reading;
  assert.equal(disposed.getSnapshot().data, null);
});

test("client uses only the fixed BFF and discards extra fields", async () => {
  const api = availabilityLoader({
    fetchMock: async (url, options) => {
      assert.equal(url, "/api/admin/profile");
      assert.equal(options.cache, "no-store");
      assert.equal(options.redirect, "error");
      assert.ok(options.signal instanceof AbortSignal);
      return Response.json({ ...adminProfileFixture(), document: "PRIVATE" });
    },
  })("features/admin-profile/api.ts").adminProfileApi;
  assert.deepEqual(await api.get(), adminProfileFixture());
});

test("client preserves HTTP errors and rejects partial or wrong-role profiles", async () => {
  for (const status of [401, 403, 500, 503]) {
    const api = availabilityLoader({
      fetchMock: async () => Response.json({ message: "PRIVATE" }, { status }),
    })("features/admin-profile/api.ts").adminProfileApi;
    await assert.rejects(
      api.get(),
      (error) => error.status === status && !error.message.includes("PRIVATE"),
    );
  }
  for (const body of [
    {},
    { ...adminProfileFixture(), role: "WORKER" },
    { ...adminProfileFixture(), email: null },
  ]) {
    const api = availabilityLoader({
      fetchMock: async () => Response.json(body),
    })("features/admin-profile/api.ts").adminProfileApi;
    await assert.rejects(api.get(), (error) => error.status === 502);
  }
});

function render(file, component, state = {}, pathname = "/admin/perfil") {
  const context = {
    AdminProfileProvider: ({ children }) => children,
    useAdminProfile: () => ({
      data: adminProfileFixture(),
      loading: false,
      error: null,
      retry() {},
      ...state,
    }),
  };
  const modules = availabilityLoader({
    mocks: {
      "next/navigation": { usePathname: () => pathname },
      "next/link": {
        __esModule: true,
        default: ({ children, ...props }) =>
          React.createElement("a", props, children),
      },
      "next/image": {
        __esModule: true,
        default: (props) => React.createElement("img", props),
      },
      "@/features/admin-profile/context": context,
      [path.resolve("features/admin-profile/context.tsx")]: context,
    },
  });
  return renderToStaticMarkup(
    React.createElement(modules(file)[component], {}, "Protected content"),
  );
}

test("ADMIN profile renders only six read-only account and business fields", () => {
  const html = render(
    "features/admin-profile/components/AdminProfilePanel.tsx",
    "AdminProfilePanel",
  );
  for (const value of [
    "admin@example.invalid",
    "Administrador",
    "Cafetería Principal",
    "Activa",
    "Sede Villavicencio",
    "Universidad de prueba",
  ])
    assert.ok(html.includes(value));
  assert.equal((html.match(/<dt>/g) ?? []).length, 6);
  assert.doesNotMatch(
    html,
    /<input|<form|Editar|Guardar|contraseña|documento|teléfono|uuid|metadata|Cerrar sesión/i,
  );
});

test("sidebar has real destinations and exactly one accessible active link", () => {
  for (const pathname of ["/admin", "/admin/catalogo", "/admin/perfil"]) {
    const html = render(
      "features/admin/components/AdminSidebar.tsx",
      "AdminSidebar",
      {},
      pathname,
    );
    assert.equal((html.match(/aria-current="page"/g) ?? []).length, 1);
    for (const href of ["/admin", "/admin/catalogo", "/admin/perfil"])
      assert.ok(html.includes(`href="${href}"`));
    assert.match(html, /<nav aria-label="Administración"/);
    assert.doesNotMatch(html, /Asistente|worker/);
  }
});

test("shell distinguishes loading, 401, 403 and retryable errors without showing protected content", () => {
  const file = "features/admin/components/AdminShell.tsx";
  const loading = render(file, "AdminShell", { data: null, loading: true });
  assert.match(loading, /role="status"/);
  assert.doesNotMatch(loading, /Protected content/);
  for (const status of [401, 403, 500, 503]) {
    const html = render(file, "AdminShell", {
      data: null,
      error: { status, message: "Mensaje seguro" },
    });
    assert.match(html, /role="alert"/);
    assert.doesNotMatch(html, /Protected content/);
    assert.equal(html.includes("Reintentar"), status !== 401 && status !== 403);
    assert.equal(html.includes('href="/panel/login"'), status === 401);
  }
});

test("inactive cafeteria banner is shared across all ADMIN surfaces with one panel logout", () => {
  const data = adminProfileFixture();
  data.cafeteria.active = false;
  const html = render(
    "features/admin/components/AdminShell.tsx",
    "AdminShell",
    { data },
  );
  assert.match(html, /role="status"/);
  assert.match(html, /La cafetería está inactiva/);
  assert.match(html, /los cambios están deshabilitados/);
  assert.match(html, /Protected content/);
  assert.equal((html.match(/Cerrar sesión/g) ?? []).length, 1);
});

test("every ADMIN page and layout rejects other active roles using their existing destination", async () => {
  for (const [role, location] of [
    ["CLIENT", "/cuenta"],
    ["WORKER", "/worker"],
    ["SUPER_ADMIN", "/super-admin"],
  ]) {
    const modules = availabilityLoader({
      mocks: {
        "next/navigation": {
          redirect: (location) => {
            throw Object.assign(new Error("redirect"), { location });
          },
        },
        "@/features/auth/server/session": {
          requireAuth: async (entrypoint) => {
            assert.equal(entrypoint, "panel");
            return { profile: { active: true, roles: [role] } };
          },
        },
      },
    });
    for (const file of [
      "app/admin/page.tsx",
      "app/admin/catalogo/page.tsx",
      "app/admin/perfil/page.tsx",
      "app/admin/layout.tsx",
    ]) {
      await assert.rejects(
        modules(file).default({ children: null }),
        (error) => error.location === location,
      );
    }
  }
});

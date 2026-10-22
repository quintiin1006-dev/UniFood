import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import path from "node:path";
import { availabilityLoader } from "./helpers/load-availability.mjs";
import { adminCatalogFixture } from "./helpers/admin-catalog-fixture.mjs";

const load = availabilityLoader();
const { parseAdminCatalog } = load("features/admin-catalog/contracts.ts");
const { formatCatalogPrice, filterCatalog } = load(
  "features/admin-catalog/presentation.ts",
);

test("catalog contract keeps exact decimal strings and strips all unrelated fields", () => {
  const raw = adminCatalogFixture();
  raw.products[0].cafeteriaId = "PRIVATE";
  raw.products[0].stock = 99;
  raw.products[0].available = true;
  raw.client = "PRIVATE";
  assert.deepEqual(parseAdminCatalog(raw), adminCatalogFixture());
  assert.deepEqual(parseAdminCatalog({ products: [] }), { products: [] });
  for (const price of ["0.01", "18500.25", "9999999999.99"]) {
    const raw = adminCatalogFixture();
    raw.products[0].price = price;
    assert.equal(parseAdminCatalog(raw).products[0].price, price);
  }
});

test("partial, malformed, duplicate, unknown-category or inexact-money rows fail closed", () => {
  const fixture = adminCatalogFixture();
  const product = fixture.products[0];
  for (const key of Object.keys(product)) {
    const missing = { ...product };
    delete missing[key];
    assert.equal(parseAdminCatalog({ products: [missing] }), null, key);
  }
  for (const patch of [
    { id: "bad" },
    { name: " " },
    { name: "a".repeat(151) },
    { description: 42 },
    { price: 18500.25 },
    { price: "0.00" },
    { price: "-1.00" },
    { price: "01.00" },
    { price: "10000000000.00" },
    { price: "1.001" },
    { price: "1e3" },
    { category: "BEBIDAS" },
    { category: null },
    { active: 1 },
    { imageUrl: {} },
  ])
    assert.equal(
      parseAdminCatalog({ products: [{ ...product, ...patch }] }),
      null,
    );
  assert.equal(
    parseAdminCatalog({
      products: [product, { ...product, id: product.id.toUpperCase() }],
    }),
    null,
  );
  for (const value of [null, [], {}, { products: null }])
    assert.equal(parseAdminCatalog(value), null);
});

test("catalog names honor PostgreSQL varchar character limits for non-BMP Unicode", () => {
  const raw = adminCatalogFixture();
  raw.products[0].name = "🍚".repeat(150);
  assert.equal(parseAdminCatalog(raw).products[0].name, raw.products[0].name);
  raw.products[0].name += "🍚";
  assert.equal(parseAdminCatalog(raw), null);
});

test("image references reuse the safe local-image policy; unsupported references become placeholders", () => {
  for (const imageUrl of [
    null,
    "",
    "https://private.invalid/x.png",
    "//evil.invalid/x.png",
    "data:image/svg+xml,secret",
    "/../private.png",
    "/x.svg",
    "/a.png?token=secret",
  ]) {
    const value = adminCatalogFixture();
    value.products[0].imageUrl = imageUrl;
    assert.equal(parseAdminCatalog(value).products[0].imageUrl, null);
  }
  assert.equal(
    parseAdminCatalog(adminCatalogFixture()).products[0].imageUrl,
    "/unifood-logo.png",
  );
});

test("COP formatting rounds presentation only and never uses floating-point arithmetic", () => {
  for (const [price, display] of [
    ["18500.00", "$ 18.500"],
    ["18500.25", "$ 18.500"],
    ["6500.50", "$ 6.501"],
    ["9999999999.99", "$ 10.000.000.000"],
    ["0.01", "$ 0"],
  ])
    assert.equal(formatCatalogPrice(price), display);
});

test("local name search is accent/case insensitive and combines both filters without altering the catalog", () => {
  const products = adminCatalogFixture().products;
  const filters = { search: "", category: "", status: "all" };
  assert.equal(filterCatalog(products, filters).length, 5);
  assert.equal(
    filterCatalog(products, { ...filters, search: " CAFE " })[0].name,
    "Desayuno con café",
  );
  assert.equal(
    filterCatalog(products, {
      ...filters,
      category: "CORRIENTE",
      status: "inactive",
      search: "CASERO",
    }).length,
    1,
  );
  assert.equal(
    filterCatalog(products, {
      ...filters,
      category: "CORRIENTE",
      status: "active",
    }).length,
    0,
  );
  assert.equal(
    filterCatalog(products, { ...filters, status: "active" }).length,
    4,
  );
  assert.equal(
    filterCatalog(products, { ...filters, search: "no existe" }).length,
    0,
  );
  assert.deepEqual(products, adminCatalogFixture().products);
});

function render(state = {}) {
  const hook = {
    useAdminCatalog: () => ({
      data: adminCatalogFixture(),
      loading: false,
      error: null,
      retry() {},
      ...state,
    }),
  };
  const load = availabilityLoader({
    mocks: {
      "@/features/admin-profile/context": {
        useAdminProfile: () => ({
          data: { cafeteria: { active: true } },
          loading: false,
          error: null,
          retry() {},
        }),
      },
      [path.resolve("features/admin-catalog/useAdminCatalog.ts")]: hook,
      "next/image": {
        __esModule: true,
        default: ({ src, alt, className }) =>
          React.createElement("img", { src, alt, className }),
      },
    },
  });
  return renderToStaticMarkup(
    React.createElement(
      load("features/admin-catalog/components/AdminCatalog.tsx").AdminCatalog,
    ),
  );
}

test("catalog renders accessible read-only cards, exact labels, optional descriptions and real controls", () => {
  const html = render();
  assert.match(html, /<h1[^>]*>Catálogo/);
  assert.equal((html.match(/<article /g) ?? []).length, 5);
  assert.match(html, /\$ 18\.500/);
  for (const label of [
    "Del día",
    "Corriente",
    "Ejecutivo",
    "Especial",
    "Desayuno",
    "Activo",
    "Inactivo",
    "Sin imagen",
    "Pollo, arroz y ensalada.",
  ])
    assert.ok(html.includes(label));
  assert.match(html, /role="search"/);
  assert.equal((html.match(/<select/g) ?? []).length, 2);
  assert.doesNotMatch(html, /Eliminar|Disponible hoy|stock|PRIVATE/);
  assert.match(html, /Nuevo producto/);
  assert.match(html, /Editar Ejecutivo de la casa/);
});

test("loading and genuine empty catalog are distinct from errors; 401/403 have appropriate actions", () => {
  assert.match(
    render({ data: null, loading: true }),
    /role="status"[^>]*>Cargando el catálogo/,
  );
  assert.match(
    render({ data: { products: [] } }),
    /Aún no hay productos en el catálogo/,
  );
  for (const status of [401, 403, 500, 502, 503]) {
    const html = render({
      data: null,
      error: { status, message: "Mensaje seguro" },
    });
    assert.match(html, /role="alert"/);
    assert.doesNotMatch(html, /Aún no hay productos|<article/);
    if (status === 401) assert.match(html, /href="\/panel\/login"/);
    else if (status === 403) assert.doesNotMatch(html, /<button/);
    else assert.match(html, /Reintentar/);
  }
});

test("browser API validates contract and uses only a fixed BFF GET with no-store, timeout and blocked redirects", async () => {
  const api = availabilityLoader({
    fetchMock: async (url, options) => {
      assert.equal(url, "/api/admin/catalog");
      assert.equal(options.method, "GET");
      assert.equal(options.body, undefined);
      assert.equal(options.redirect, "error");
      assert.equal(options.cache, "no-store");
      assert.equal(options.credentials, "same-origin");
      assert.ok(options.signal instanceof AbortSignal);
      return Response.json(adminCatalogFixture());
    },
  })("features/admin-catalog/api.ts").adminCatalogApi;
  assert.deepEqual(await api.get(), adminCatalogFixture());
  for (const status of [401, 403, 500, 502, 503]) {
    const api = availabilityLoader({
      fetchMock: async () => Response.json({ message: "PRIVATE" }, { status }),
    })("features/admin-catalog/api.ts").adminCatalogApi;
    await assert.rejects(
      api.get(),
      (e) => e.status === status && !e.message.includes("PRIVATE"),
    );
  }
  const malformed = availabilityLoader({
    fetchMock: async () => Response.json({ products: [{}] }),
  })("features/admin-catalog/api.ts").adminCatalogApi;
  await assert.rejects(malformed.get(), (e) => e.status === 502);
  const unavailable = availabilityLoader({
    fetchMock: async () => {
      throw new Error("PRIVATE");
    },
  })("features/admin-catalog/api.ts").adminCatalogApi;
  await assert.rejects(unavailable.get(), (e) => e.status === 503);
});

test("catalog state suppresses stale responses, exposes retry and drops protected data after failure", async () => {
  const { AdminCatalogStore } = load("features/admin-catalog/state.ts");
  let resolveFirst;
  let count = 0;
  const store = new AdminCatalogStore({
    get: async () =>
      ++count === 1
        ? new Promise((resolve) => {
            resolveFirst = resolve;
          })
        : adminCatalogFixture(),
  });
  const first = store.refresh();
  await store.refresh();
  resolveFirst({ products: [] });
  await first;
  assert.equal(store.getSnapshot().data.products.length, 5);
  let fail = true;
  const retry = new AdminCatalogStore({
    get: async () => {
      if (fail) throw new Error("PRIVATE");
      return adminCatalogFixture();
    },
  });
  await retry.refresh();
  assert.equal(retry.getSnapshot().error.status, 503);
  assert.equal(retry.getSnapshot().data, null);
  assert.doesNotMatch(retry.getSnapshot().error.message, /PRIVATE/);
  fail = false;
  await retry.refresh();
  assert.equal(retry.getSnapshot().error, null);
  assert.equal(retry.getSnapshot().data.products.length, 5);
  store.dispose();
  retry.dispose();
});

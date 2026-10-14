import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  availabilityLoader,
  availabilityFixture,
} from "./helpers/load-availability.mjs";

function render(state = {}) {
  const data = availabilityFixture();
  const defaults = {
    data,
    loading: false,
    refreshing: false,
    error: null,
    notice: null,
    busyItems: [],
    cafeteriaBusy: false,
    itemErrors: {},
    cafeteriaError: null,
    refresh() {},
    setItem() {},
    setCafeteria() {},
  };
  const load = availabilityLoader({
    mocks: {
      [path.resolve("features/availability/useAvailability.ts")]: {
        useAvailability: () => ({ ...defaults, ...state }),
      },
      "next/image": ({ src, alt, className }) =>
        React.createElement("img", { src, alt, className }),
    },
  });
  return renderToStaticMarkup(
    React.createElement(
      load("features/availability/components/AvailabilityPanel.tsx")
        .AvailabilityPanel,
    ),
  );
}

test("panel renders all five categories in order, independent rails and clean empty groups", () => {
  const markup = render();
  const labels = ["Del día", "Corriente", "Ejecutivo", "Especial", "Desayuno"];
  const positions = labels.map((label) => markup.indexOf(`>${label}</h3>`));
  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual(
    [...positions].sort((a, b) => a - b),
    positions,
  );
  assert.match(markup, /aria-label="Productos de Corriente"/);
  assert.equal(
    (markup.match(/No hay productos en esta categoría/g) ?? []).length,
    4,
  );
  assert.match(markup, /Almuerzo corriente/);
  assert.match(markup, /15\.000/);
  assert.match(markup, /<img[^>]+alt="Almuerzo corriente"/);
  assert.match(markup, /Sin imagen/);
});

test("visible open and available flags drive semantic switches and the administrative summary", () => {
  const markup = render({
    data: availabilityFixture({ open: true, available: true }),
  });
  assert.match(
    markup,
    /aria-checked="true" aria-label="Apertura de cafetería"/,
  );
  assert.match(
    markup,
    /aria-checked="true" aria-label="Disponibilidad de Almuerzo corriente"/,
  );
  assert.match(markup, />ABIERTA</);
  assert.match(markup, />Disponible</);
  assert.match(render(), />CERRADA</);
  assert.match(render(), />No disponible</);
  assert.match(markup, /Estado administrativo/);
  assert.match(markup, />Activa</);
  assert.match(markup, /13 de octubre de 2026/);
});

test("inactive cafeteria blocks enabling but keeps closing and disabling controls", () => {
  const markup = render({
    data: availabilityFixture({ active: false, open: true, available: true }),
  });
  const buttons = [...markup.matchAll(/<button[^>]*role="switch"[^>]*>/g)].map(
    (match) => match[0],
  );
  assert.equal(buttons.length, 3);
  assert.ok(!buttons[0].includes("disabled"));
  assert.ok(!buttons[1].includes("disabled"));
  assert.ok(buttons[2].includes("disabled"));
  assert.match(markup, /administrativamente inactiva/);
  assert.match(markup, />Inactiva</);
});

test("loading and initial error do not render unconfirmed switches; retry and saving are visible", () => {
  const loading = render({ data: null, loading: true });
  assert.match(loading, /Cargando disponibilidad/);
  assert.ok(!loading.includes('role="switch"'));
  const failed = render({ data: null, error: "Error temporal" });
  assert.match(failed, /role="alert"/);
  assert.match(failed, /Reintentar/);
  const saving = render({
    busyItems: [availabilityFixture().categories[1].items[0].id],
  });
  assert.match(saving, /Guardando/);
  assert.match(saving, /aria-busy="true"/);
});

test("image source validation uses only supplied local raster paths and never opens remote optimization", () => {
  const presentation = availabilityLoader()(
    "features/availability/presentation.ts",
  );
  assert.equal(
    presentation.productImageSource("/photos/lunch.jpg"),
    "/photos/lunch.jpg",
  );
  for (const source of [
    null,
    "",
    "https://unknown.example/lunch.jpg",
    "//evil.test/a.png",
    "/../secret.png",
    "javascript:alert(1)",
    "data:image/png;base64,a",
    "/image.svg",
    "/photo.png?secret=1",
  ])
    assert.equal(presentation.productImageSource(source), null);
  assert.equal(
    presentation.formatBusinessDate("2026-10-13"),
    "13 de octubre de 2026",
  );
  assert.equal(
    presentation.formatBusinessDate("2026-02-01"),
    "1 de febrero de 2026",
  );
});

for (const count of [0, 1, 6]) {
  test(`a category with ${count} products keeps its summary, cards and empty state coherent`, () => {
    const data = availabilityFixture();
    const item = data.categories[1].items[0];
    data.categories[1].items = Array.from({ length: count }, (_, index) => ({
      ...item,
      id: `00000000-0000-0000-0000-${String(index + 101).padStart(12, "0")}`,
      name: `Producto ${index + 1}`,
    }));
    const markup = render({ data });
    assert.equal((markup.match(/<article /g) ?? []).length, count);
    assert.match(
      markup,
      new RegExp(`>${count} ${count === 1 ? "producto" : "productos"}<`),
    );
    assert.equal(
      markup.includes('aria-label="Productos de Corriente"'),
      count > 0,
    );
    assert.equal(
      (markup.match(/No hay productos en esta categoría/g) ?? []).length,
      count === 0 ? 5 : 4,
    );
  });
}

test("browser availability API sends no identity or cafeteria and validates acknowledgements", async () => {
  const calls = [];
  const load = availabilityLoader({
    fetchMock: async (url, options) => {
      calls.push([url, options]);
      if (options.method !== "PUT") return Response.json(availabilityFixture());
      const body = JSON.parse(options.body);
      return Response.json({
        businessDate: "2026-10-13",
        ...body,
        ...(url.includes("/items/")
          ? { itemId: availabilityFixture().categories[1].items[0].id }
          : {}),
      });
    },
  });
  const api = load("features/availability/api.ts").availabilityApi;
  const today = await api.today();
  await api.cafeteria(today.businessDate, true);
  await api.item(today.categories[1].items[0].id, today.businessDate, false);
  assert.equal(calls.length, 3);
  for (const [url, options] of calls) {
    assert.ok(url.startsWith("/api/worker/availability/today"));
    assert.ok(!url.includes("cafeteriaId"));
    assert.equal(options.cache, "no-store");
    assert.equal(options.credentials, "same-origin");
    assert.equal(options.redirect, "error");
    assert.ok(options.signal instanceof AbortSignal);
    if (options.method === "PUT")
      assert.equal(options.headers["X-Business-Date"], today.businessDate);
    assert.equal(options.headers?.authorization, undefined);
  }
});

test("WORKER header is module-aware and keeps order search out of Availability", () => {
  const load = availabilityLoader({
    mocks: {
      "next/image": ({ src, alt }) => React.createElement("img", { src, alt }),
      "@/features/auth/components/LogoutButton": () =>
        React.createElement("button", null, "Salir"),
    },
  });
  const Header = load("components/worker/Header.tsx").default;
  const markup = (module) =>
    renderToStaticMarkup(
      React.createElement(Header, {
        activeModule: module,
        search: "",
        onSearchChange() {},
      }),
    );
  assert.match(markup("orders"), /Gestión de pedidos/);
  assert.match(markup("orders"), /role="search"/);
  assert.match(markup("availability"), /Disponibilidad/);
  assert.ok(!markup("availability").includes('role="search"'));
  const BottomNav = load("components/worker/BottomNav.tsx").default;
  const nav = renderToStaticMarkup(
    React.createElement(BottomNav, {
      activeModule: "availability",
      onChange() {},
    }),
  );
  assert.match(nav, /aria-current="page" aria-label="Disponibilidad"/);
  assert.ok(!nav.includes("Inventario"));
});

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  availabilityLoader,
  availabilityFixture,
} from "./helpers/load-availability.mjs";

const HIDDEN_EDITOR = { status: "hidden", day: null };

function editorDay({ published = false, complete = true } = {}) {
  return {
    businessDate: "2026-10-13",
    version: 1,
    published,
    complete,
    missingCategories: [],
    priceSet: true,
    title: "Almuerzo del día",
    price: "9500.00",
    categories: [],
    additions: [],
  };
}

function editorState(status, day = null) {
  return {
    status,
    day,
    categories: [],
    additions: [],
    pending: 0,
    offline: false,
    busyAction: null,
    notice: null,
    resync: 0,
    refresh() {},
    setOptions() {},
    setAddition() {},
    runAction() {},
  };
}

function render(state = {}, dailyMenu = editorState("hidden")) {
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
      [path.resolve("features/daily-menu/useDailyMenu.ts")]: {
        useDailyMenu: () => dailyMenu,
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

test("panel renders all six categories in order, independent rails and clean empty groups", () => {
  const markup = render();
  const labels = [
    "Del día",
    "Corriente",
    "Ejecutivo",
    "Especial",
    "Desayuno",
    "Bebida",
  ];
  const positions = labels.map((label) => markup.indexOf(`>${label}</h3>`));
  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual(
    [...positions].sort((a, b) => a - b),
    positions,
  );
  assert.match(markup, /aria-label="Productos de Corriente"/);
  assert.equal(
    (markup.match(/No hay productos en esta categoría/g) ?? []).length,
    5,
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
  // C: a failed read is the brand's soft notice, not a red alert.
  assert.match(failed, /data-tone="error" data-surface="glass" role="status"/);
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
      count === 0 ? 6 : 5,
    );
  });
}

test("BEBIDA products get their own rail, label, price and availability switch", () => {
  const data = availabilityFixture({ open: true });
  const beverage = data.categories.find(
    ({ category }) => category === "BEBIDA",
  );
  beverage.items = [
    {
      id: "00000000-0000-0000-0000-000000000031",
      name: "Jugo natural",
      price: 4500,
      description: null,
      image: null,
      available: true,
    },
  ];
  const markup = render({ data });
  assert.match(markup, />Bebida<\/h3>/);
  assert.match(markup, /aria-label="Productos de Bebida"/);
  assert.match(markup, /Jugo natural/);
  assert.match(markup, /4\.500/);
  assert.match(
    markup,
    /aria-checked="true" aria-label="Disponibilidad de Jugo natural"/,
  );
});

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
  // jj/cliente-ajustes-2 · D1: only the brand in the header; the nav names the module.
  assert.doesNotMatch(markup("orders"), /Gestión de pedidos/);
  assert.match(markup("orders"), /role="search"/);
  assert.doesNotMatch(markup("availability"), /<p>Disponibilidad<\/p>/);
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

test("the availability contract requires the six categories in the backend order", () => {
  const { parseToday } = availabilityLoader()(
    "features/availability/contracts.ts",
  );
  const today = availabilityFixture();
  assert.deepEqual(
    parseToday(today).categories.map(({ category }) => category),
    ["DEL_DIA", "CORRIENTE", "EJECUTIVO", "ESPECIAL", "DESAYUNO", "BEBIDA"],
  );
  // The shape from before 019, or BEBIDA out of place, fails closed.
  assert.equal(
    parseToday({ ...today, categories: today.categories.slice(0, 5) }),
    null,
  );
  assert.equal(
    parseToday({
      ...today,
      categories: [today.categories[5], ...today.categories.slice(0, 5)],
    }),
    null,
  );
});

test("A1: an open cafeteria without available products shows a persistent warning, no confirmation", () => {
  const warning =
    /La cafetería está abierta, pero no hay productos disponibles/;
  const open = render({ data: availabilityFixture({ open: true }) });
  assert.match(open, warning);
  assert.match(
    open,
    /id="availability-open-without-products"[^>]*role="status"/,
  );
  assert.ok(!open.includes('role="alertdialog"'));
  // The switch to open stays a plain switch: nothing asks before opening.
  assert.match(open, /aria-checked="true" aria-label="Apertura de cafetería"/);
  assert.doesNotMatch(
    render({ data: availabilityFixture({ open: true, available: true }) }),
    warning,
  );
  assert.doesNotMatch(render({ data: availabilityFixture() }), warning);
  assert.doesNotMatch(
    render({ data: availabilityFixture({ active: false, open: true }) }),
    warning,
  );
});

test("showDelDiaSection: the editor takes «Del día»'s place only while it is active", () => {
  const { showDelDiaSection } = availabilityLoader()(
    "features/availability/presentation.ts",
  );
  // Flag off, 401, 403 or 404: no editor, «Del día» as today, with or without products.
  assert.equal(showDelDiaSection(HIDDEN_EDITOR, 0), true);
  assert.equal(showDelDiaSection(HIDDEN_EDITOR, 3), true);
  // A failed first read: the error notice, and «Del día» as today.
  assert.equal(showDelDiaSection({ status: "error", day: null }, 3), true);
  assert.equal(showDelDiaSection({ status: "error", day: null }, 0), true);
  // Loading for the first time: the skeleton holds the place, «Del día» waits (no flicker).
  assert.equal(showDelDiaSection({ status: "loading", day: null }, 0), false);
  assert.equal(showDelDiaSection({ status: "loading", day: null }, 3), false);
  // Ready without «Del día» products: always gives way.
  for (const published of [true, false])
    for (const complete of [true, false])
      assert.equal(
        showDelDiaSection({ status: "ready", day: { published, complete } }, 0),
        false,
      );
  // Ready with «Del día» products: hidden only while the menu is published and complete.
  const ready = (published, complete) =>
    showDelDiaSection({ status: "ready", day: { published, complete } }, 2);
  assert.equal(ready(true, true), false);
  assert.equal(ready(true, false), true);
  assert.equal(ready(false, true), true);
  assert.equal(ready(false, false), true);
  // «ready» without a day never hides it.
  assert.equal(showDelDiaSection({ status: "ready", day: null }, 0), true);
});

test("panel order: cafeteria row, then the daily menu editor, then the catalogue without «Del día»", () => {
  const markup = render(
    {},
    editorState("ready", editorDay({ published: true })),
  );
  const cafeteria = markup.indexOf('id="availability-cafeteria-name"');
  const editor = markup.indexOf('id="daily-menu-editor-title"');
  const corriente = markup.indexOf(">Corriente</h3>");
  assert.ok(cafeteria >= 0 && editor > cafeteria && corriente > editor);
  assert.equal(markup.indexOf(">Del día</h3>"), -1);
  // Corriente and the others stay, in their order.
  const rest = ["Corriente", "Ejecutivo", "Especial", "Desayuno", "Bebida"].map(
    (label) => markup.indexOf(`>${label}</h3>`),
  );
  assert.ok(rest.every((position) => position > editor));
  assert.deepEqual(
    [...rest].sort((a, b) => a - b),
    rest,
  );
});

test("panel: a draft menu with «Del día» products keeps the section, under the editor", () => {
  const data = availabilityFixture();
  data.categories[0].items = [
    {
      ...data.categories[1].items[0],
      id: "00000000-0000-0000-0000-000000000023",
    },
  ];
  const draft = render(
    { data },
    editorState("ready", editorDay({ published: false })),
  );
  const editor = draft.indexOf('id="daily-menu-editor-title"');
  assert.ok(editor >= 0 && draft.indexOf(">Del día</h3>") > editor);
  // Published and complete: the same products give way to the editor.
  const published = render(
    { data },
    editorState("ready", editorDay({ published: true })),
  );
  assert.equal(published.indexOf(">Del día</h3>"), -1);
  // An empty «Del día» gives way even to a draft.
  assert.equal(
    render({}, editorState("ready", editorDay())).indexOf(">Del día</h3>"),
    -1,
  );
});

test("panel: hidden editor shows «Del día» as today; loading shows the skeleton instead", () => {
  const hidden = render({}, editorState("hidden"));
  assert.ok(hidden.indexOf(">Del día</h3>") >= 0);
  assert.equal(hidden.indexOf('id="daily-menu-editor-title"'), -1);
  const loading = render({}, editorState("loading"));
  assert.equal(loading.indexOf(">Del día</h3>"), -1);
  const skeleton = loading.indexOf('aria-label="Cargando el menú del día"');
  assert.ok(skeleton > loading.indexOf('id="availability-cafeteria-name"'));
  assert.ok(skeleton < loading.indexOf(">Corriente</h3>"));
  const error = render({}, editorState("error"));
  assert.ok(error.indexOf(">Del día</h3>") >= 0);
});

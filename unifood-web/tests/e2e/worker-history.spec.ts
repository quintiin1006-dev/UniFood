import { test, expect as baseExpect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { workerHistoryFixture } from "../helpers/worker-history-fixture.mjs";

const expect = baseExpect.configure({ timeout: 20_000 });
test.skip(
  !!process.env.PLAYWRIGHT_BASE_URL,
  "Requires controlled local provider/backend fixtures.",
);
const root = "/api/worker/orders/history";
const panel = (page: Page) =>
  page.getByRole("region", { name: "Historial", exact: true });
async function configure(page: Page, config: Record<string, unknown>) {
  const result = await page.request.post(
    "http://127.0.0.1:3101/__test/worker-history",
    { data: { email: "worker@example.invalid", ...config } },
  );
  expect(result.status()).toBe(200);
}
async function login(page: Page) {
  await page.goto("/panel/login");
  await page
    .getByLabel("Usuario o correo institucional", { exact: true })
    .fill("worker@example.invalid");
  await page.getByLabel("Contraseña", { exact: true }).fill("UnaClave8");
  await page
    .getByRole("button", { name: "Iniciar sesión", exact: true })
    .click();
  await expect(page).toHaveURL(/\/worker$/);
  await expect(
    page.getByText("Estudiante de prueba", { exact: true }),
  ).toBeVisible();
  await page.addStyleTag({
    content: "nextjs-portal { visibility: hidden !important; }",
  });
}
async function enter(page: Page) {
  await page.getByRole("button", { name: "Historial", exact: true }).click();
  await expect(panel(page)).toBeVisible();
}
async function loaded(page: Page) {
  await expect(panel(page).getByRole("article")).toHaveCount(3);
}
test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date("2026-10-14T18:00:00Z") });
  await configure(page, { reset: true });
});

test("monthly paging and temporal filters retain snapshots without exposing other months or metrics", async ({
  page,
}) => {
  const data = workerHistoryFixture();
  data.orders = Array.from({ length: 35 }, (_, i) => {
    const prefix = (i + 1).toString(16).padStart(8, "0");
    return {
      ...data.orders[0],
      id: prefix + "-0000-0000-0000-000000000001",
      reference: "Pedido · " + prefix.toUpperCase(),
      clientName: i === 34 ? null : "Cliente histórico " + i,
      completedAt:
        i < 10
          ? "2026-10-01T17:00:00Z"
          : i < 30
            ? "2026-10-13T17:00:00Z"
            : "2026-10-14T17:00:00Z",
      items: [
        {
          name: "Producto histórico " + i,
          quantity: 1,
          unitPrice: 10000,
          subtotal: 10000,
        },
      ],
    };
  });
  data.orders.push({
    ...data.orders[0],
    id: "eeeeeeee-0000-0000-0000-000000000001",
    reference: "Pedido · EEEEEEEE",
    clientName: "Mes anterior privado",
    completedAt: "2026-09-30T17:00:00Z",
  });
  data.orders.push({
    ...data.orders[0],
    id: "dddddddd-0000-0000-0000-000000000001",
    reference: "Pedido · DDDDDDDD",
    clientName: "Mes futuro privado",
    completedAt: "2026-11-01T17:00:00Z",
  });
  await configure(page, { data });
  await login(page);
  await enter(page);
  await expect(panel(page).getByRole("article")).toHaveCount(30);
  await expect(panel(page).getByText("Cliente no disponible")).toBeVisible();
  await expect(panel(page)).not.toContainText(
    /Mes anterior privado|Mes futuro privado|pedidos finalizados|ventas|ingresos|KPIs/i,
  );
  await panel(page)
    .getByRole("button", { name: "Cargar más", exact: true })
    .click();
  await expect(panel(page).getByRole("article")).toHaveCount(35);
  await expect(
    panel(page).getByRole("button", { name: "Cargar más", exact: true }),
  ).toHaveCount(0);
  await panel(page).getByLabel("Período del historial").selectOption("TODAY");
  await expect(panel(page).getByRole("article")).toHaveCount(5);
  await panel(page).getByLabel("Período del historial").selectOption("WEEK");
  await expect(panel(page).getByRole("article")).toHaveCount(25);
  await panel(page)
    .getByLabel("Estado del historial")
    .selectOption("CANCELLED");
  await expect(
    panel(page).getByText(
      "No encontramos pedidos que coincidan con los filtros.",
    ),
  ).toBeVisible();
  await panel(page)
    .getByRole("button", { name: "Limpiar filtros", exact: true })
    .click();
  await expect(panel(page).getByRole("article")).toHaveCount(30);
  await expect(panel(page).getByLabel("Período del historial")).toHaveValue(
    "MONTH",
  );
});

test("search debounce sends one request for rapid input and server results preserve the query", async ({
  page,
}) => {
  await login(page);
  await enter(page);
  await loaded(page);
  await page.clock.pauseAt(new Date("2026-10-14T18:00:15Z"));
  let reads = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === root) reads++;
  });
  const input = panel(page).getByRole("searchbox");
  await input.fill("J");
  await input.fill("Ju");
  await input.fill("Juan");
  expect(reads).toBe(0);
  await page.clock.fastForward(299);
  expect(reads).toBe(0);
  const result = page.waitForResponse(
    (response) => new URL(response.url()).pathname === root,
  );
  await page.clock.fastForward(1);
  await result;
  await expect(panel(page).getByRole("article")).toHaveCount(2);
  expect(reads).toBe(1);
  await expect(input).toHaveValue("Juan");
});

test("server search filters reference, state, customer and products, clears with keyboard and survives refresh", async ({
  page,
}) => {
  await login(page);

  await enter(page);
  await loaded(page);
  const search = panel(page).getByRole("searchbox", {
    name: "Buscar por pedido, cliente, estado o producto",
  });
  let reads = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === root) reads++;
  });
  for (const [query, expected] of [
    ["a91c", 1],
    ["NOT_COLLECTED", 1],
    ["No recogido", 1],
    ["cancel", 1],
    ["juan", 2],
    ["ejecutivo", 1],
    [" PEREZ ", 1],
  ] as const) {
    await search.fill(query);
    await expect(panel(page).getByRole("article")).toHaveCount(expected);
    await panel(page)
      .getByRole("button", { name: "Limpiar búsqueda", exact: true })
      .click();
    await expect(search).toBeFocused();
    await expect(panel(page).getByRole("article")).toHaveCount(3);
  }
  expect(reads).toBeGreaterThan(0);
  await search.fill("nadie coincide");
  await expect(
    panel(page).getByRole("heading", {
      name: "No encontramos pedidos que coincidan con los filtros.",
    }),
  ).toBeVisible();
  await panel(page).getByRole("button", { name: "Limpiar filtros" }).click();
  await expect(search).toBeFocused();
  await expect(panel(page).getByRole("article")).toHaveCount(3);
  await search.fill("perez");
  const updated = workerHistoryFixture();
  updated.orders[2].clientName = "Ana Pérez";
  await configure(page, { data: updated });
  await page.clock.fastForward(30000);
  await expect(search).toHaveValue("perez");
  await expect(panel(page).getByRole("article")).toHaveCount(2);
  await expect(panel(page).getByRole("article").first()).toContainText(
    "Juan Pérez",
  );
  await search.press("Tab");
  await expect(
    panel(page).getByRole("button", { name: "Limpiar búsqueda", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(search).toHaveValue("");
  await expect(panel(page).getByRole("article")).toHaveCount(3);
});

test("WORKER history shows only ordered terminal snapshots and survives reload/re-entry", async ({
  page,
}) => {
  await login(page);
  await enter(page);
  await loaded(page);
  for (const label of [
    "Entregado",
    "No recogido",
    "Cancelado",
    "Almuerzo del día",
    "Especial histórico",
  ])
    await expect(
      panel(page).getByLabel("Pedidos finalizados").getByText(label),
    ).toBeVisible();
  await expect(panel(page).getByRole("heading", { level: 3 })).toHaveText([
    "Pedido · A91C6F2D",
    "Pedido · B72D5A10",
    "Pedido · C83E6B21",
  ]);
  await expect(panel(page)).not.toContainText("Estudiante de prueba");
  await expect(panel(page)).not.toContainText("Pendiente");
  await expect(panel(page).getByText(/14 de octubre de 2026/)).toBeVisible();
  await expect(panel(page).getByText(/12:43/)).toBeVisible();
  const response = await page.request.get(
    `${root}?cafeteriaId=FOREIGN&date=1900-01-01&status=PENDING`,
  );
  expect(response.status()).toBe(400);
  expect(response.headers()["cache-control"]).toBe("no-store");
  expect((await response.json()).code).toBe("WORKER_HISTORY_INVALID_REQUEST");
  const fractional = workerHistoryFixture();
  fractional.orders[0].total = 19000.5;
  fractional.orders[0].items[0].unitPrice = 15000.5;
  fractional.orders[0].items[0].subtotal = 15000.5;
  await configure(page, { data: fractional });
  await panel(page)
    .getByRole("button", { name: "Actualizar historial" })
    .click();
  await expect(panel(page).getByText(/19\.000,50/)).toBeVisible();
  await expect(panel(page).getByText(/15\.000,50/)).toBeVisible();
  await configure(page, { reset: true });
  await page.getByRole("button", { name: "Pedidos", exact: true }).click();
  await expect(panel(page)).toHaveCount(0);
  await expect(
    page.getByText("Estudiante de prueba", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("Estudiante de prueba", { exact: true }),
  ).toBeVisible();
  await page.addStyleTag({
    content: "nextjs-portal { visibility: hidden !important; }",
  });
  await enter(page);
  await loaded(page);
});

test("503 preserves cookies and recovers through retry without login or raw errors", async ({
  page,
}) => {
  await login(page);
  const cookies = (await page.context().cookies()).filter((cookie) =>
    cookie.name.includes("auth-token"),
  );
  expect(cookies.length).toBeGreaterThan(0);
  await configure(page, { mode: "503" });
  await enter(page);
  await expect(panel(page).getByRole("alert")).toContainText(
    "No pudimos cargar el historial en este momento.",
  );
  await expect(panel(page)).not.toContainText("PRIVATE");
  expect(
    (await page.context().cookies()).filter((cookie) =>
      cookie.name.includes("auth-token"),
    ),
  ).toEqual(cookies);
  await configure(page, { mode: null });
  await panel(page)
    .getByRole("button", { name: "Reintentar", exact: true })
    .click();
  await loaded(page);
  await expect(panel(page).getByRole("alert")).toHaveCount(0);
  await expect(page).toHaveURL(/\/worker$/);
});

test("empty history is a normal accessible state", async ({ page }) => {
  await configure(page, {
    data: { ...workerHistoryFixture(), orders: [], hasHistory: false },
  });
  await login(page);
  await enter(page);
  await expect(
    panel(page).getByRole("heading", {
      name: "Aún no hay pedidos finalizados este mes.",
    }),
  ).toBeVisible();
  await expect(panel(page).getByRole("alert")).toHaveCount(0);
  await expect(panel(page).getByRole("article")).toHaveCount(0);
});

test("403 denies safely without a retry or automatic login loop", async ({
  page,
}) => {
  await configure(page, { mode: "403" });
  await login(page);
  await enter(page);
  await expect(panel(page).getByRole("alert")).toContainText(
    "No tienes permisos",
  );
  await expect(
    panel(page).getByRole("button", { name: "Reintentar" }),
  ).toHaveCount(0);
  await expect(page).toHaveURL(/\/worker$/);
});

test("a malformed upstream terminal contract fails safely and can recover", async ({
  page,
}) => {
  const data = workerHistoryFixture();
  data.orders[0].status = "PENDING";
  await configure(page, { data, mode: "raw" });
  await login(page);
  await enter(page);
  await expect(panel(page).getByRole("alert")).toContainText(
    "No pudimos cargar un historial válido",
  );
  await expect(panel(page).getByRole("article")).toHaveCount(0);
  await configure(page, { reset: true });
  await panel(page).getByRole("button", { name: "Reintentar" }).click();
  await loaded(page);
});

test("polls every 30 seconds with no active-order traffic, then resumes Pedidos", async ({
  page,
}) => {
  await login(page);

  await enter(page);
  await loaded(page);
  let historyReads = 0,
    orderReads = 0;
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path === root) historyReads++;
    if (path === "/api/orders") orderReads++;
  });
  const poll = page.waitForResponse(
    (response) => new URL(response.url()).pathname === root,
  );
  await page.clock.fastForward(30000);
  await poll;
  expect(historyReads).toBe(1);
  expect(orderReads).toBe(0);
  const focus = page.waitForResponse(
    (response) => new URL(response.url()).pathname === root,
  );
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await focus;
  expect(historyReads).toBe(2);
  await page.getByRole("button", { name: "Pedidos", exact: true }).click();
  const orders = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/orders",
  );
  await page.clock.fastForward(10000);
  await orders;
  expect(orderReads).toBeGreaterThan(0);
  const before = historyReads;
  await page.clock.fastForward(30000);
  expect(historyReads).toBe(before);
});

test("month rollover hides October before the November request completes", async ({
  page,
}) => {
  await page.clock.setSystemTime(new Date("2026-11-01T04:59:55Z"));
  const old = workerHistoryFixture();
  old.businessDate = "2026-10-31";
  old.rangeEnd = "2026-11-01";
  old.nextBusinessDateAt = "2026-11-01T05:00:00Z";
  await configure(page, { data: old });
  await login(page);
  await enter(page);
  await loaded(page);
  const next = {
    ...old,
    businessDate: "2026-11-01",
    monthStart: "2026-11-01",
    rangeStart: "2026-11-01",
    rangeEnd: "2026-11-02",
    nextBusinessDateAt: "2026-11-02T05:00:00Z",
  };
  await configure(page, { data: next });
  await page.clock.fastForward(5000);
  await expect(panel(page).getByRole("article")).toHaveCount(0);
  await expect(
    panel(page).getByText("Aún no hay pedidos finalizados este mes."),
  ).toBeVisible();
  await expect(panel(page)).not.toContainText("Juan Pérez");
});

test("late response after exit cannot replace a new history snapshot", async ({
  page,
}) => {
  await login(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let arrived!: () => void;
  const requestArrived = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  let first = true;
  await page.route(`**${root}*`, async (route) => {
    if (!first) {
      await route.continue();
      return;
    }
    first = false;
    const response = await route.fetch();
    arrived();
    await gate;
    await route.fulfill({ response }).catch(() => {});
  });
  try {
    await enter(page);
    await requestArrived;
    await expect(panel(page).getByText("Cargando historial…")).toBeVisible();
    await page.getByRole("button", { name: "Pedidos", exact: true }).click();
    await configure(page, {
      data: { ...workerHistoryFixture(), orders: [], hasHistory: false },
    });
    await enter(page);
    await expect(
      panel(page).getByText("Aún no hay pedidos finalizados este mes."),
    ).toBeVisible();
    release();
    await expect(panel(page).getByRole("article")).toHaveCount(0);
  } finally {
    release();
    await page.unroute(`**${root}*`);
  }
});

for (const width of [390, 768, 1366]) {
  test(`history is readable, centered and navigable at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await login(page);
    await enter(page);
    await loaded(page);
    await expect(panel(page).getByRole("article").first()).toBeVisible();
    const search = panel(page).getByRole("searchbox", {
      name: "Buscar por pedido, cliente, estado o producto",
    });
    await expect(search).toBeVisible();
    await search.fill("cancelado");
    await expect(panel(page).getByRole("article")).toHaveCount(1);
    await panel(page)
      .getByRole("button", { name: "Limpiar búsqueda", exact: true })
      .click();
    await expect(search).toBeFocused();
    await expect(panel(page).getByRole("article")).toHaveCount(3);
    const dimensions = await page.evaluate(() => ({
      viewport: innerWidth,
      width: document.documentElement.scrollWidth,
    }));
    expect(dimensions.width).toBeLessThanOrEqual(dimensions.viewport);
    for (const name of [
      "Pedidos",
      "Llamadas",
      "Historial",
      "Disponibilidad",
      "Mi perfil",
    ]) {
      const button = page.getByRole("button", { name, exact: true });
      await expect(button).toBeInViewport();
      const bounds = await button.boundingBox();
      expect(bounds!.height).toBeGreaterThanOrEqual(44);
    }
    const first = panel(page).getByRole("article").first();
    await expect(first.getByText(/19\.000/)).toBeVisible();
    await expect(first.getByRole("heading", { level: 3 })).toBeVisible();
    const bounds = await panel(page).boundingBox();
    expect(bounds!.width).toBeLessThanOrEqual(1320);
    if (width === 1366)
      expect(Math.abs(bounds!.x - (width - bounds!.width) / 2)).toBeLessThan(8);
    await page.getByRole("button", { name: "Actualizar historial" }).focus();
    await expect(
      page.getByRole("button", { name: "Actualizar historial" }),
    ).toBeFocused();
    if (process.env.WORKER_HISTORY_VISUAL_AUDIT === "1") {
      const directory = join(tmpdir(), "unifood-worker-history-visual");
      await mkdir(directory, { recursive: true });
      await page.screenshot({
        path: join(directory, `${width}-history.png`),
        animations: "disabled",
        scale: "css",
      });
    }
    await page
      .getByRole("button", { name: "Disponibilidad", exact: true })
      .click();
    await expect(
      page.getByRole("region", { name: "Disponibilidad", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Historial", exact: true }).click();
    await loaded(page);
  });
}

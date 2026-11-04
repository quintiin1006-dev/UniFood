import { test, expect as baseExpect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AdminDashboardData } from "../../features/admin-dashboard/types";
import {
  formatCount,
  formatMoney,
  formatPercent,
  formatDay,
} from "../../features/admin-dashboard/presentation";
const expect = baseExpect.configure({ timeout: 20000 });
const provider = "http://127.0.0.1:3101";
test.skip(
  !!process.env.PLAYWRIGHT_BASE_URL,
  "Requires isolated local Auth/backend fixtures.",
);
async function configure(page: Page, config: Record<string, unknown>) {
  expect(
    (
      await page.request.post(provider + "/__test/admin-dashboard", {
        data: { email: "admin@example.invalid", ...config },
      })
    ).status(),
  ).toBe(200);
}
async function login(page: Page) {
  await page.goto("/panel/login");
  await page
    .getByLabel("Usuario o correo institucional", { exact: true })
    .fill("admin@example.invalid");
  await page.getByLabel("Contraseña", { exact: true }).fill("UnaClave8");
  await page
    .getByRole("button", { name: "Iniciar sesión", exact: true })
    .click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(
    page.getByRole("heading", { name: "Dashboard", exact: true }),
  ).toBeVisible();
}
const view = (page: Page) =>
  page.getByRole("region", { name: "Dashboard", exact: true });
async function ready(page: Page) {
  await expect(
    view(page).getByRole("heading", {
      name: "Resumen del período",
      exact: true,
    }),
  ).toBeVisible();
}
test.beforeEach(async ({ page }) => {
  await configure(page, { reset: true });
  await page.request.post(provider + "/__test/admin-profile", {
    data: { email: "admin@example.invalid", reset: true },
  });
});
test.afterEach(async ({ page }) => {
  await configure(page, { reset: true });
});

test("dashboard integrates the ADMIN shell, exact metrics, accessible trend and historical products", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page);
  await ready(page);
  await expect(
    page.getByRole("banner").getByText("Cafetería Principal", { exact: true }),
  ).toBeVisible();
  const dashboard = view(page);
  for (const title of [
    "Pedidos por día",
    "Productos no recogidos",
    "Productos más entregados",
  ])
    await expect(
      dashboard.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
  await expect(dashboard).toContainText("25,00 %");
  await expect(dashboard).toContainText("$ 30,00");
  await expect(dashboard).not.toContainText(
    /Próximamente|PRIVATE|UNVERIFIED_ORDER_PROVENANCE|SQL/,
  );
  await expect(
    dashboard.getByRole("group", {
      name: "Pedidos recibidos, entregados y no recogidos por día",
    }),
  ).toHaveCount(1);
  await dashboard
    .getByText("Ver datos diarios en tabla", { exact: true })
    .click();
  await expect(
    dashboard.getByRole("table", { name: "Pedidos por día de Colombia" }),
  ).toBeVisible();
  await dashboard.locator("#dashboard-coverage summary").click();
  await expect(dashboard.locator("#dashboard-coverage")).toContainText(
    "No se ha comprobado todo el histórico",
  );
  await expect(
    dashboard.getByRole("table", { name: "Comprobaciones de cobertura" }),
  ).toHaveCount(0);
  await expect(dashboard).toContainText("operaciones reales");
  const response = await page.request.get("/api/admin/dashboard?range=TODAY");
  expect(response.headers()["cache-control"]).toBe("no-store");
  expect(await response.text()).not.toMatch(/PRIVATE/);
  expect(errors).toEqual([]);
});
test("all filters affect the whole snapshot and custom dates have explicit validation", async ({
  page,
}) => {
  await login(page);
  await ready(page);
  const dashboard = view(page);
  for (const label of ["Últimos 7 días", "Últimos 30 días", "Hoy"]) {
    await dashboard.getByRole("button", { name: label, exact: true }).click();
    await ready(page);
    await expect(
      dashboard.getByRole("button", { name: label, exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
  }
  await dashboard
    .getByRole("button", { name: "Personalizado", exact: true })
    .click();
  await dashboard
    .getByLabel("Fecha inicial", { exact: true })
    .fill("2024-01-01");
  await dashboard.getByLabel("Fecha final", { exact: true }).fill("2025-01-01");
  await dashboard
    .getByRole("button", { name: "Aplicar fechas", exact: true })
    .click();
  await expect(dashboard.getByRole("alert")).toContainText("366 días");
  await dashboard
    .getByLabel("Fecha inicial", { exact: true })
    .fill("2099-01-01");
  await dashboard.getByLabel("Fecha final", { exact: true }).fill("2099-01-01");
  await dashboard
    .getByRole("button", { name: "Aplicar fechas", exact: true })
    .click();
  await expect(dashboard.getByRole("alert")).toContainText(
    "posteriores a hoy en Colombia",
  );
  await dashboard
    .getByLabel("Fecha inicial", { exact: true })
    .fill("2024-01-01");
  await dashboard.getByLabel("Fecha final", { exact: true }).fill("2024-01-03");
  await dashboard
    .getByRole("button", { name: "Aplicar fechas", exact: true })
    .click();
  await ready(page);
  await expect(
    dashboard.getByRole("group", { name: "Período consultado", exact: true }),
  ).toContainText("1–3 ene 2024");
  await dashboard
    .getByText("Ver datos diarios en tabla", { exact: true })
    .click();
  await expect(
    dashboard
      .getByRole("table", { name: "Pedidos por día de Colombia" })
      .getByRole("row"),
  ).toHaveCount(4);
});

test("every displayed metric, daily row and ranking matches the received BFF snapshot", async ({
  page,
}) => {
  await login(page);
  await ready(page);
  const responsePromise = page.waitForResponse((response) =>
    response.url().includes("/api/admin/dashboard?range=LAST_7_DAYS"),
  );
  await view(page)
    .getByRole("button", { name: "Últimos 7 días", exact: true })
    .click();
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  const data: AdminDashboardData = await response.json();
  await ready(page);
  const bars = await view(page)
    .locator("svg rect[data-series]")
    .evaluateAll((elements) =>
      elements.map((element) => ({
        date: element.getAttribute("data-date"),
        series: element.getAttribute("data-series"),
        count: element.getAttribute("data-count"),
      })),
    );
  expect(bars).toEqual(
    data.trend.flatMap((day) => [
      { date: day.date, series: "receivedOrders", count: day.receivedOrders },
      { date: day.date, series: "deliveredOrders", count: day.deliveredOrders },
      {
        date: day.date,
        series: "notCollectedOrders",
        count: day.notCollectedOrders,
      },
    ]),
  );
  const summary = view(page).getByRole("region", {
    name: "Resumen del período",
    exact: true,
  });
  for (const [label, value] of [
    ["Pedidos recibidos", formatCount(data.summary.receivedOrders)],
    ["Pedidos entregados", formatCount(data.summary.deliveredOrders)],
    ["Pedidos no recogidos", formatCount(data.summary.notCollectedOrders)],
    ["Unidades no recogidas", formatCount(data.summary.notCollectedUnits)],
    [
      "Valor de pedidos registrados",
      formatMoney(data.summary.receivedOrderValue),
    ],
    [
      "Tasa de no recogida",
      formatPercent(data.summary.notCollectedRatePercent),
    ],
  ])
    await expect(
      summary
        .getByText(label, { exact: true })
        .locator("xpath=ancestor::div[1]")
        .locator("dd"),
    ).toHaveText(value);

  const notCollected = view(page).getByRole("region", {
    name: "Productos no recogidos",
    exact: true,
  });
  for (const [label, value] of [
    [
      "Productos distintos afectados",
      formatCount(data.notCollectedProducts.totals.products),
    ],
    [
      "Valor asociado a pedidos no recogidos",
      formatMoney(data.summary.notCollectedOrderValue),
    ],
  ])
    await expect(
      notCollected
        .getByText(label, { exact: true })
        .locator("..")
        .locator("dd"),
    ).toHaveText(value);

  for (const [label, ranking, uncollected] of [
    ["Productos entregados", data.topDeliveredProducts, false],
    ["Productos no recogidos", data.notCollectedProducts, true],
  ] as const) {
    const rows = view(page)
      .getByRole("table", {
        name: `${label}: Top ${ranking.limit} por unidades`,
        exact: true,
      })
      .locator("tbody tr");
    await expect(rows).toHaveCount(ranking.items.length);
    for (const [index, item] of ranking.items.entries()) {
      await expect(rows.nth(index).getByRole("rowheader")).toContainText(
        item.historicalName ?? "Nombre histórico no disponible",
      );
      await expect(rows.nth(index).getByRole("cell")).toHaveText([
        formatCount(item.units),
        ...(uncollected ? [formatPercent(item.unitSharePercent)] : []),
        formatCount(item.orders),
        formatMoney(item.itemValue),
      ]);
    }
  }
  await view(page)
    .getByText("Ver datos diarios en tabla", { exact: true })
    .click();
  const days = view(page)
    .getByRole("table", { name: "Pedidos por día de Colombia" })
    .locator("tbody tr");
  await expect(days).toHaveCount(data.trend.length);
  for (const [index, day] of data.trend.entries()) {
    await expect(days.nth(index).getByRole("rowheader")).toHaveText(
      formatDay(day.date),
    );
    await expect(days.nth(index).getByRole("cell")).toHaveText([
      formatCount(day.receivedOrders),
      formatCount(day.deliveredOrders),
      formatCount(day.notCollectedOrders),
    ]);
  }
});
test("slow obsolete period cannot restore old metrics after a newer empty result", async ({
  page,
}) => {
  await login(page);
  await ready(page);
  await configure(page, { delay: 1800 });
  await view(page)
    .getByRole("button", { name: "Últimos 7 días", exact: true })
    .click();
  await expect(view(page).getByRole("status")).toContainText(
    "Consultando el período seleccionado",
  );
  await expect(
    view(page).getByRole("heading", { name: "Resumen del período" }),
  ).toHaveCount(0);
  await configure(page, { delay: 0, scenario: "empty" });
  await view(page).getByRole("button", { name: "Hoy", exact: true }).click();
  await ready(page);
  await expect(view(page)).toContainText(
    "no confirma ausencia total de actividad",
  );
  await page.waitForTimeout(2100);
  await expect(view(page)).toContainText("Sin base de cálculo");
  await expect(
    view(page).getByRole("button", { name: "Hoy", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});
test("incomplete rankings retain header values and unknown units are never zero", async ({
  page,
}) => {
  await configure(page, { scenario: "incomplete" });
  await login(page);
  await ready(page);
  const section = view(page).getByRole("region", {
    name: "Productos no recogidos",
    exact: true,
  });
  await expect(section).toContainText("Ranking no disponible");
  await expect(section).toContainText("No calculable");
  await expect(section).toContainText("$ 30,00");
  await expect(section.getByRole("table")).toHaveCount(0);
  await expect(
    view(page).locator("#dashboard-coverage details"),
  ).toHaveAttribute("open", "");
  await expect(view(page).locator("#dashboard-coverage")).toContainText(
    "Faltan detalles fiables",
  );
  await expect(
    view(page)
      .getByRole("region", { name: "Productos más entregados", exact: true })
      .getByRole("table"),
  ).toHaveCount(1);
});

for (const width of [390, 768, 1440])
  test(`P4.3 executive layout preserves exact metrics and honest empty coverage at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await login(page);
    await ready(page);
    const directory = join(tmpdir(), "unifood-admin-p43-visual");
    await mkdir(directory, { recursive: true });
    const dashboard = view(page);
    const summary = dashboard.getByRole("region", {
      name: "Resumen del período",
      exact: true,
    });
    await expect(
      summary.locator("dl").first().getByRole("definition"),
    ).toHaveCount(5);
    await expect(summary.getByRole("definition")).toHaveCount(6);
    for (const text of [
      "Pedidos no recogidos",
      "Unidades no recogidas",
      "Valor de pedidos registrados",
      "Valor asociado a pedidos no recogidos",
    ])
      await expect(dashboard.getByText(text, { exact: true })).toHaveCount(1);
    await expect(dashboard).not.toContainText("Universo completo");
    const filterBar = dashboard
      .getByRole("group", { name: "Período", exact: true })
      .locator("..");
    await expect(
      filterBar.getByRole("group", { name: "Período consultado", exact: true }),
    ).toBeVisible();
    const order = await dashboard.evaluate((el) =>
      [...el.querySelectorAll("h2")].map((h) => h.textContent),
    );
    expect(order).toEqual([
      "Resumen del período",
      "Pedidos por día",
      "Productos no recogidos",
      "Productos más entregados",
      "Información sobre los datos",
    ]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollHeight <= innerHeight,
      ),
    ).toBe(true);
    expect(
      await page
        .getByRole("main")
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await page.screenshot({
      path: join(directory, `${width}-overview.png`),
      fullPage: true,
    });
    const moneyInfo = dashboard.getByLabel(
      "Sobre el valor de pedidos registrados",
      { exact: true },
    );
    await moneyInfo.focus();
    await page.keyboard.press("Enter");
    await expect(
      dashboard.getByText(/Importe registrado, incluidos pedidos cancelados/),
    ).toBeVisible();
    expect(
      await page
        .getByRole("main")
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await page.keyboard.press("Escape");
    await expect(moneyInfo).toBeFocused();
    const uncollected = dashboard.getByRole("region", {
      name: "Productos no recogidos",
      exact: true,
    });
    await uncollected.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: join(directory, `${width}-not-collected.png`),
      fullPage: true,
    });
    const coverage = dashboard.locator("#dashboard-coverage");
    await expect(coverage.getByRole("table")).toHaveCount(0);
    await expect(coverage).not.toContainText("podrían no incluir");
    const why = coverage.locator("summary");
    await why.focus();
    await page.keyboard.press("Enter");
    await expect(
      coverage.getByText("No se ha comprobado todo el histórico de pedidos.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(why).toBeFocused();
    await coverage.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: join(directory, `${width}-coverage.png`),
      fullPage: true,
    });
    await configure(page, { scenario: "empty" });
    await dashboard
      .getByRole("button", { name: "Actualizar", exact: true })
      .click();
    await ready(page);
    await expect(dashboard).toContainText("Sin base de cálculo");
    await expect(
      dashboard.getByText("Sin eventos verificables en este período", {
        exact: true,
      }),
    ).toHaveCount(1);
    await expect(dashboard).toContainText(
      "Sin productos no recogidos verificables en este período.",
    );
    await expect(dashboard).toContainText(
      "Sin productos entregados verificables en este período.",
    );
    await expect(dashboard.locator("#dashboard-coverage-title")).toHaveCount(1);
    await expect(dashboard).not.toContainText("Sin pedidos para mostrar");
    await page.getByRole("main").evaluate((el) => {
      el.scrollTop = 0;
    });
    await page.screenshot({
      path: join(directory, `${width}-empty.png`),
      fullPage: true,
    });
  });
for (const status of [401, 403, 503])
  test(`error ${status} withdraws results and offers the appropriate action`, async ({
    page,
  }) => {
    await login(page);
    await ready(page);
    const cookies = await page.context().cookies();
    await configure(page, { mode: String(status) });
    await view(page)
      .getByRole("button", { name: "Actualizar", exact: true })
      .click();
    await expect(view(page).getByRole("alert")).toBeVisible();
    await expect(
      view(page).getByRole("heading", { name: "Resumen del período" }),
    ).toHaveCount(0);
    await expect(
      view(page).getByRole("link", { name: "Iniciar sesión", exact: true }),
    ).toHaveCount(status === 401 ? 1 : 0);
    await expect(
      view(page).getByRole("button", { name: "Reintentar", exact: true }),
    ).toHaveCount(status === 503 ? 1 : 0);
    expect(await page.context().cookies()).toEqual(cookies);
    if (status === 503) {
      await configure(page, { mode: null });
      await view(page)
        .getByRole("button", { name: "Reintentar", exact: true })
        .click();
      await ready(page);
    }
  });
for (const width of [390, 768, 1440])
  test(`dashboard ${width}px: responsive, keyboard access, SVG and tables without global overflow`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await login(page);
    await ready(page);
    await view(page)
      .getByRole("button", { name: "Últimos 7 días", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    await ready(page);
    await expect(
      view(page).getByRole("button", { name: "Últimos 7 días", exact: true }),
    ).toBeFocused();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    const directory = join(tmpdir(), "unifood-admin-dashboard-visual");
    await mkdir(directory, { recursive: true });
    await page.screenshot({
      path: join(directory, `${width}-overview.png`),
      fullPage: true,
    });
    await view(page)
      .getByRole("heading", { name: "Pedidos por día", exact: true })
      .scrollIntoViewIfNeeded();
    const chart = view(page).getByRole("region", {
      name: "Gráfico diario de pedidos",
      exact: true,
    });
    await chart.focus();
    await expect(chart).toBeFocused();
    if (
      await chart.evaluate(
        (element) => element.scrollWidth > element.clientWidth,
      )
    ) {
      await page.keyboard.press("End");
      await expect
        .poll(() => chart.evaluate((element) => element.scrollLeft))
        .toBeGreaterThan(0);
      await chart.evaluate((element) => {
        element.scrollLeft = 0;
      });
    }
    await chart.evaluate((element) => element.blur());
    await page.screenshot({
      path: join(directory, `${width}-dashboard.png`),
      fullPage: true,
    });
    await view(page)
      .getByRole("region", { name: "Productos no recogidos", exact: true })
      .scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: join(directory, `${width}-not-collected.png`),
      fullPage: true,
    });
  });
test("large counts and exact cents wrap without Number precision loss", async ({
  page,
}) => {
  await configure(page, { scenario: "large" });
  await login(page);
  await ready(page);
  await expect(view(page)).toContainText("900.719.925.474.099.312.345");
  await expect(view(page)).toContainText("$ 12.345.678.901.234.567.890.123,45");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

for (const width of [390, 768, 1440])
  test(`visible ADMIN text meets minimum contrast across all views at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await login(page);
    await ready(page);
    await view(page)
      .getByText("Ver datos diarios en tabla", { exact: true })
      .click();
    await view(page).locator("#dashboard-coverage summary").click();
    const textContrast = (root: Element) => {
      const rgb = (value: string) => (value.match(/[\d.]+/g) ?? []).map(Number);
      const luminance = (channels: number[]) =>
        channels
          .slice(0, 3)
          .map((value) => {
            const channel = value / 255;
            return channel <= 0.04045
              ? channel / 12.92
              : ((channel + 0.055) / 1.055) ** 2.4;
          })
          .reduce(
            (sum, value, index) =>
              sum + value * [0.2126, 0.7152, 0.0722][index],
            0,
          );
      const failures: {
        text: string;
        color: string;
        background: string;
        ratio: number;
        minimum: number;
      }[] = [];
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        const element = node.parentElement;
        if (
          !element ||
          !node.textContent?.trim() ||
          ["TITLE", "DESC"].includes(element.tagName.toUpperCase())
        )
          continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        if (
          ![...range.getClientRects()].some((rect) => rect.width && rect.height)
        )
          continue;
        const style = getComputedStyle(element);
        if (style.visibility !== "visible") continue;
        let ancestor: Element | null = element;
        const layers: number[][] = [];
        while (ancestor) {
          const ancestorStyle = getComputedStyle(ancestor);
          const stops = ancestorStyle.backgroundImage.match(/rgba?\([^)]+\)/g);
          // The lightest gradient stop bounds contrast conservatively at every y.
          // Solid foreground surfaces remain composited above this opaque layer.
          if (
            ancestorStyle.backgroundImage.startsWith("linear-gradient(") &&
            stops
          ) {
            const lightest = stops
              .map(rgb)
              .sort((a, b) => luminance(b) - luminance(a))[0];
            layers.push([...lightest.slice(0, 3), 1]);
            break;
          }
          const candidate = ancestorStyle.backgroundColor;
          const channels = rgb(candidate);
          if ((channels[3] ?? 1) > 0) layers.push(channels);
          if ((channels[3] ?? 1) === 1) break;
          ancestor = ancestor.parentElement;
        }
        let blended = [255, 255, 255];
        for (const layer of layers.reverse()) {
          const alpha = layer[3] ?? 1;
          blended = layer
            .slice(0, 3)
            .map((channel, i) =>
              Math.round(channel * alpha + blended[i] * (1 - alpha)),
            );
        }
        const background = `rgb(${blended.join(", ")})`;
        const color = element instanceof SVGElement ? style.fill : style.color;
        const colorChannels = rgb(color);
        const colorAlpha = colorChannels[3] ?? 1;
        const foreground = luminance(
            colorChannels
              .slice(0, 3)
              .map(
                (channel, i) =>
                  channel * colorAlpha + blended[i] * (1 - colorAlpha),
              ),
          ),
          backdrop = luminance(rgb(background));
        const ratio =
          (Math.max(foreground, backdrop) + 0.05) /
          (Math.min(foreground, backdrop) + 0.05);
        const size = parseFloat(style.fontSize);
        const minimum =
          size >= 24 || (size >= 18.66 && parseInt(style.fontWeight) >= 700)
            ? 3
            : 4.5;
        if (ratio < minimum)
          failures.push({
            text: node.textContent.trim().slice(0, 55),
            color,
            background,
            ratio: Math.round(ratio * 100) / 100,
            minimum,
          });
      }
      return failures;
    };
    for (const [path, heading] of [
      ["/admin", "Dashboard"],
      ["/admin/catalogo", "Catálogo"],
      ["/admin/perfil", "Mi perfil"],
    ]) {
      if (path !== "/admin") await page.goto(path);
      await expect(
        page.getByRole("heading", { name: heading, exact: true }),
      ).toBeVisible();
      const failures = await page.locator("body").evaluate(textContrast);
      expect(failures, `${heading}: text contrast at ${width}px`).toEqual([]);
    }
  });

test("a custom 366-day bar chart keeps every day and supports keyboard scrolling on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 1000 });
  await login(page);
  await ready(page);
  await view(page)
    .getByRole("button", { name: "Personalizado", exact: true })
    .click();
  await view(page)
    .getByLabel("Fecha inicial", { exact: true })
    .fill("2024-01-01");
  await view(page)
    .getByLabel("Fecha final", { exact: true })
    .fill("2024-12-31");
  await view(page)
    .getByRole("button", { name: "Aplicar fechas", exact: true })
    .click();
  await ready(page);
  const chart = view(page).getByRole("region", {
    name: "Gráfico diario de pedidos",
    exact: true,
  });
  await expect(chart.locator("rect[data-series]")).toHaveCount(1098);
  await chart.focus();
  await page.keyboard.press("End");
  await expect
    .poll(() => chart.evaluate((element) => element.scrollLeft))
    .toBeGreaterThan(0);
  expect(
    await page
      .getByRole("main")
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  await view(page)
    .getByText("Ver datos diarios en tabla", { exact: true })
    .click();
  await expect(
    view(page)
      .getByRole("table", { name: "Pedidos por día de Colombia" })
      .getByRole("row"),
  ).toHaveCount(367);
  await expect(chart.locator('rect[data-date="2024-12-31"]')).toHaveCount(3);
});

for (const width of [390, 768, 1440])
  test(`ADMIN visual system at ${width}px: shared navigation, contrast, branding and reduced motion`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await login(page);
    await ready(page);
    const directory = join(tmpdir(), "unifood-admin-p4-visual");
    await mkdir(directory, { recursive: true });
    for (const [path, label, capture] of [
      ["/admin", "Dashboard", "dashboard"],
      ["/admin/catalogo", "Catálogo", "catalog"],
      ["/admin/perfil", "Mi perfil", "profile"],
    ]) {
      if (path !== "/admin") await page.goto(path);
      await expect(
        page.getByRole("heading", { name: label, exact: true }),
      ).toBeVisible();
      const main = page.getByRole("main");
      expect(
        await main.evaluate(
          (element) => element.scrollWidth <= element.clientWidth,
        ),
      ).toBe(true);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: join(directory, `${width}-${capture}.png`),
        fullPage: true,
      });
      const toggle = page.getByRole("button", {
        name: "Abrir navegación",
        exact: true,
      });
      if (width < 1024) {
        await toggle.focus();
        await page.keyboard.press("Enter");
        await expect(
          page.getByRole("dialog", { name: "Navegación administrativa" }),
        ).toBeVisible();
      }
      const nav = page.getByRole("navigation", {
        name: "Administración",
        exact: true,
      });
      const current = nav.getByRole("link", { name: label, exact: true });
      await expect(
        nav.getByRole("list", { name: "Próximos módulos" }),
      ).toContainText("Asistente IA");
      await expect(
        nav.getByRole("list", { name: "Próximos módulos" }),
      ).not.toContainText("Configuración");
      await expect(nav.getByRole("link")).toHaveCount(3);
      await expect(
        page
          .getByRole("banner")
          .getByText("Cafetería Principal", { exact: true }),
      ).toBeVisible();
      await expect(current).toHaveAttribute("aria-current", "page");
      await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
      const logo = nav.locator("..").locator("img");
      await expect(logo).toHaveAttribute("src", /unifood-logo/);
      await expect
        .poll(() =>
          logo.evaluate(
            (image: HTMLImageElement) =>
              image.complete && image.naturalWidth > 0,
          ),
        )
        .toBe(true);
      await current.focus();
      await expect(current).toBeFocused();
      const focus = await current.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          style: style.outlineStyle,
          width: parseFloat(style.outlineWidth),
          indicator: parseFloat(getComputedStyle(element, "::before").width),
          duration: style.transitionDuration,
        };
      });
      expect(focus.style).toBe("solid");
      expect(focus.width).toBeGreaterThanOrEqual(3);
      expect(focus.indicator).toBeGreaterThanOrEqual(2);
      expect(
        focus.duration.split(",").every((value) => parseFloat(value) === 0),
      ).toBe(true);
      await nav
        .getByRole("link", {
          name: label === "Dashboard" ? "Catálogo" : "Dashboard",
          exact: true,
        })
        .hover();
      const contrast = await nav.evaluate((element) => {
        const rgb = (value: string) =>
          (value.match(/[\d.]+/g) ?? []).map(Number);
        const luminance = (value: string) =>
          rgb(value)
            .slice(0, 3)
            .map((value) => {
              const channel = value / 255;
              return channel <= 0.04045
                ? channel / 12.92
                : ((channel + 0.055) / 1.055) ** 2.4;
            })
            .reduce(
              (sum, channel, index) =>
                sum + channel * [0.2126, 0.7152, 0.0722][index],
              0,
            );
        const surfaceStyle = getComputedStyle(
          element.closest("aside, dialog")!,
        );
        const stops =
          surfaceStyle.backgroundImage.match(/rgba?\([^)]+\)/g) ?? [];
        // A conservative bound: links must pass even over the brightest stop.
        const surface =
          stops.sort((a, b) => luminance(b) - luminance(a))[0] ??
          surfaceStyle.backgroundColor;
        return [...element.querySelectorAll("a")].map((link) => {
          const style = getComputedStyle(link);
          const layer = rgb(style.backgroundColor);
          const parent = rgb(surface);
          const alpha = layer[3] ?? 1;
          const background = `rgb(${layer
            .slice(0, 3)
            .map((channel, i) =>
              Math.round(channel * alpha + parent[i] * (1 - alpha)),
            )
            .join(", ")})`;
          const foreground = luminance(style.color),
            backdrop = luminance(background);
          return (
            (Math.max(foreground, backdrop) + 0.05) /
            (Math.min(foreground, backdrop) + 0.05)
          );
        });
      });
      expect(Math.min(...contrast)).toBeGreaterThanOrEqual(4.5);
      if (width < 1024) {
        await page.screenshot({
          path: join(directory, `${width}-${capture}-drawer.png`),
          fullPage: true,
        });
        await page.keyboard.press("Escape");
        await expect(toggle).toBeFocused();
      }
    }
  });

test("period and rate details and chart values are accessible with keyboard and Escape", async ({
  page,
}) => {
  await login(page);
  await ready(page);
  const period = view(page).getByRole("group", {
    name: "Período consultado",
    exact: true,
  });
  const info = period.getByLabel("Detalles del período", { exact: true });
  await info.focus();
  await page.keyboard.press("Enter");
  await expect(period.getByText(/Importes en COP/)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(period.getByText(/Importes en COP/)).not.toBeVisible();
  await expect(info).toBeFocused();
  const rateInfo = view(page).getByLabel("Cómo se calcula la tasa", {
    exact: true,
  });
  await rateInfo.focus();
  await page.keyboard.press("Enter");
  await expect(view(page).getByText(/No recogidos ÷/)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(view(page).getByText(/No recogidos ÷/)).not.toBeVisible();
  await view(page)
    .getByRole("button", { name: "Últimos 7 días", exact: true })
    .click();
  await ready(page);
  const chart = view(page).getByRole("region", {
    name: "Gráfico diario de pedidos",
    exact: true,
  });
  await chart.focus();
  await page.keyboard.press("Home");
  const tooltip = view(page).getByRole("tooltip");
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText("Recibidos:");
  await expect(tooltip).toContainText("Entregados:");
  await expect(tooltip).toContainText("No recogidos:");
  const first = await tooltip.textContent();
  await page.keyboard.press("ArrowRight");
  await expect(tooltip).not.toHaveText(first!);
  await page.keyboard.press("Escape");
  await expect(tooltip).toHaveCount(0);
});

test("short desktop keeps KPIs near the top and the full sidebar usable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 640 });
  await login(page);
  await ready(page);
  const metric = view(page)
    .getByText("Pedidos recibidos", { exact: true })
    .first();
  const bounds = await metric.boundingBox();
  expect(bounds!.y).toBeLessThan(380);
  const nav = page.getByRole("navigation", {
    name: "Administración",
    exact: true,
  });
  await expect(
    nav.getByRole("link", { name: "Mi perfil", exact: true }),
  ).toBeInViewport();
  await expect(nav).not.toContainText("Configuración");
  await expect(
    page.getByText("Tu cafetería, en un solo lugar.", { exact: true }),
  ).toHaveCount(0);
  expect(
    await page
      .getByRole("main")
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  const directory = join(tmpdir(), "unifood-admin-p42-visual");
  await mkdir(directory, { recursive: true });
  await page.screenshot({
    path: join(directory, "1440x640-dashboard.png"),
    fullPage: true,
  });
});

for (const width of [390, 768, 1440])
  test(`P4.2 branding, loading placeholders and recovery remain usable at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await configure(page, { delay: 2200 });
    await login(page);
    const directory = join(tmpdir(), "unifood-admin-p42-visual");
    await mkdir(directory, { recursive: true });
    await expect(view(page).getByRole("status")).toContainText(
      "Consultando el período seleccionado",
    );
    await expect(
      view(page).locator('div[class*="skeletonChart"]'),
    ).toBeVisible();
    await page.screenshot({
      path: join(directory, `${width}-initial-loading.png`),
      fullPage: true,
    });
    await ready(page);
    await view(page)
      .getByRole("button", { name: "Últimos 7 días", exact: true })
      .click();
    const status = view(page).getByRole("status");
    await expect(status).toContainText("Consultando el período seleccionado");
    const skeleton = view(page)
      .locator('[aria-hidden="true"]')
      .filter({ has: page.locator('div[class*="skeletonChart"]') });
    await expect(skeleton).toHaveCount(1);
    await expect(skeleton).not.toContainText(/[0-9$%]/);
    await expect(skeleton.locator("button, a, input, [tabindex]")).toHaveCount(
      0,
    );
    expect(
      await skeleton.evaluate((el) =>
        [...el.querySelectorAll("*")].every((child) => {
          const style = getComputedStyle(child);
          return style.animationName === "none";
        }),
      ),
    ).toBe(true);
    await expect(
      view(page).getByRole("heading", {
        name: "Resumen del período",
        exact: true,
      }),
    ).toHaveCount(0);
    expect(
      await page
        .getByRole("main")
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await page.screenshot({
      path: join(directory, `${width}-loading.png`),
      fullPage: true,
    });
    await ready(page);
    await expect(skeleton).toHaveCount(0);
    await expect(status).toHaveCount(0);
    await page.screenshot({
      path: join(directory, `${width}-dashboard.png`),
      fullPage: true,
    });
    const toggle = page.getByRole("button", {
      name: "Abrir navegación",
      exact: true,
    });
    if (width < 1024) await toggle.click();
    const nav = page.getByRole("navigation", {
      name: "Administración",
      exact: true,
    });
    const brand = nav.locator("..");
    const icon = brand.locator("img");
    await expect(icon).toHaveAttribute("src", /unifood-logo/);
    const dimensions = await icon.boundingBox();
    expect(dimensions!.width).toBe(52);
    expect(dimensions!.height).toBe(52);
    const surface = await brand.evaluate((el) => {
      const surface = el.closest("aside, dialog")!;
      const image = el.querySelector("img")!;
      const text = el.querySelector("strong")!;
      const a = image.getBoundingClientRect(),
        b = text.getBoundingClientRect(),
        textBlock = text.parentElement!.getBoundingClientRect();
      return {
        background: getComputedStyle(surface).backgroundImage,
        width: surface.getBoundingClientRect().width,
        textColor: getComputedStyle(text).color,
        aligned:
          a.right < b.left &&
          Math.abs(a.top + a.bottom - (textBlock.top + textBlock.bottom)) < 2,
        overflow: surface.scrollWidth > surface.clientWidth,
      };
    });
    expect(surface.background).toContain("rgb(11, 95, 255)");
    expect(surface.background).toContain("rgb(11, 45, 107)");
    expect(surface.textColor).toBe("rgb(255, 255, 255)");
    expect(surface.aligned).toBe(true);
    expect(surface.overflow).toBe(false);
    if (width === 1440) expect(surface.width).toBe(272);
    await expect(nav.getByRole("link")).toHaveCount(3);
    await expect(nav).not.toContainText("Configuración");
    await page.screenshot({
      path: join(directory, `${width}-navigation.png`),
      fullPage: true,
    });
    if (width < 1024) {
      // A short drawer scrolls rather than clipping navigation or branding.
      await page.setViewportSize({ width, height: 360 });
      const profile = nav.getByRole("link", { name: "Mi perfil", exact: true });
      await profile.focus();
      await expect(profile).toBeInViewport();
      await page.screenshot({
        path: join(directory, `${width}-short-drawer.png`),
        fullPage: true,
      });
      await page.keyboard.press("Escape");
      await expect(toggle).toBeFocused();
      await page.setViewportSize({ width, height: 1000 });
    }
  });

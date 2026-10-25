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
    "Evolución diaria de pedidos",
    "Productos no recogidos",
    "Productos más entregados",
    "Cobertura limitada",
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
    dashboard.getByRole("img", {
      name: "Pedidos diarios recibidos, entregados y no recogidos",
    }),
  ).toHaveCount(1);
  await dashboard
    .getByText("Ver datos diarios en tabla", { exact: true })
    .click();
  await expect(
    dashboard.getByRole("table", { name: "Pedidos por día de Colombia" }),
  ).toBeVisible();
  await dashboard
    .getByText("Consultar advertencias y alcance de las comprobaciones", {
      exact: true,
    })
    .click();
  await expect(
    dashboard.getByRole("table", { name: "Comprobaciones de cobertura" }),
  ).toContainText("No comprobado");
  await expect(dashboard).toContainText("reales o de prueba");
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
  await expect(dashboard).toContainText("01 de enero de 2024");
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
      "Valor asociado a no recogidos",
      formatMoney(data.summary.notCollectedOrderValue),
    ],
    [
      "Tasa de no recogida",
      formatPercent(data.summary.notCollectedRatePercent),
    ],
  ])
    await expect(
      summary.getByText(label, { exact: true }).locator("..").locator("dd"),
    ).toHaveText(value);

  const notCollected = view(page).getByRole("region", {
    name: "Productos no recogidos",
    exact: true,
  });
  for (const [label, value] of [
    ["Pedidos no recogidos", formatCount(data.summary.notCollectedOrders)],
    ["Unidades no recogidas", formatCount(data.summary.notCollectedUnits)],
    [
      "Valor asociado a pedidos",
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
        formatCount(item.orders),
        formatMoney(item.itemValue),
        ...(uncollected ? [formatPercent(item.unitSharePercent)] : []),
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
    view(page)
      .getByRole("region", { name: "Productos más entregados", exact: true })
      .getByRole("table"),
  ).toHaveCount(1);
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
      .getByRole("heading", { name: "Evolución diaria de pedidos" })
      .scrollIntoViewIfNeeded();
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
  test(`visible dashboard text meets minimum contrast at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await login(page);
    await ready(page);
    await view(page)
      .getByText("Ver datos diarios en tabla", { exact: true })
      .click();
    await view(page)
      .getByText("Consultar advertencias y alcance de las comprobaciones", {
        exact: true,
      })
      .click();
    const failures = await view(page).evaluate((root) => {
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
        let background = "rgb(255, 255, 255)";
        while (ancestor) {
          const candidate = getComputedStyle(ancestor).backgroundColor;
          const channels = rgb(candidate);
          if (channels.length === 3 || channels[3] === 1) {
            background = candidate;
            break;
          }
          ancestor = ancestor.parentElement;
        }
        const color = element instanceof SVGElement ? style.fill : style.color;
        const foreground = luminance(rgb(color)),
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
    });
    expect(failures).toEqual([]);
  });

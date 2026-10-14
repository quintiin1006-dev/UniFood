import {
  test,
  expect as baseExpect,
  type Page,
  type Route,
} from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const expect = baseExpect.configure({ timeout: 20_000 });
test.skip(
  !!process.env.PLAYWRIGHT_BASE_URL,
  "Requires controlled local provider/backend fixtures.",
);
const root = "/api/worker/availability/today";
const itemId = "00000000-0000-0000-0000-000000000021";
const secondId = "00000000-0000-0000-0000-000000000022";
async function configure(page: Page, config: Record<string, unknown>) {
  const result = await page.request.post(
    "http://127.0.0.1:3101/__test/availability",
    {
      data: { email: "worker@example.invalid", ...config },
    },
  );
  expect(result.status()).toBe(200);
}
async function audit(page: Page) {
  return (
    await page.request.get(
      "http://127.0.0.1:3101/__test/availability?email=worker@example.invalid",
    )
  ).json() as Promise<{
    gets: number;
    puts: {
      path: string;
      day: string;
      body: { available?: boolean; open?: boolean };
    }[];
    directBusinessReads: number;
  }>;
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
}
async function enter(page: Page) {
  // Client-fetched orders confirm that dashboard hydration finished before navigation.
  await expect(
    page.getByText("Estudiante de prueba", { exact: true }),
  ).toBeVisible();
  // Exclude development-only chrome that can cover the mobile navigation.
  await page.addStyleTag({
    content: "nextjs-portal { visibility: hidden !important; }",
  });
  await page
    .getByRole("button", { name: "Disponibilidad", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Disponibilidad", exact: true }),
  ).toBeVisible();
}
const cafeteria = (page: Page) =>
  page.getByRole("switch", { name: "Apertura de cafetería", exact: true });
const product = (page: Page) =>
  page.getByRole("switch", {
    name: "Disponibilidad de Almuerzo corriente",
    exact: true,
  });
const availability = (page: Page) =>
  page.getByRole("region", { name: "Disponibilidad", exact: true });
const cafeteriaSummary = (page: Page) =>
  availability(page).getByRole("region", {
    name: "Cafetería de prueba",
    exact: true,
  });

async function capture(page: Page, width: number, view: string) {
  if (process.env.AVAILABILITY_VISUAL_AUDIT !== "1") return;
  const directory = join(tmpdir(), "unifood-availability-ux-visual");
  await mkdir(directory, { recursive: true });
  await page.screenshot({
    path: join(directory, `${width}-${view}.png`),
    animations: "disabled",
    scale: "css",
  });
}

async function holdMutation(page: Page, path: string, networkFailure = false) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let arrived!: () => void;
  const requestArrived = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  const pattern = `**${path}`;
  const handler = async (route: Route) => {
    const response = networkFailure ? null : await route.fetch();
    arrived();
    await gate;
    if (response) await route.fulfill({ response });
    else await route.abort("failed");
  };
  await page.route(pattern, handler);
  return {
    arrived: requestArrived,
    release,
    async cleanup() {
      release();
      await page.unroute(pattern, handler);
    },
  };
}

test.beforeEach(async ({ page }) => {
  await configure(page, { reset: true });
});

test("WORKER operates confirmed daily states, persists reloads and navigates between independent modules", async ({
  page,
}) => {
  await login(page);
  await enter(page);
  await expect(page.getByRole("search")).toHaveCount(0);
  await expect(
    page
      .getByRole("heading", { level: 3 })
      .filter({ hasText: /^(Del día|Corriente|Ejecutivo|Especial|Desayuno)$/ }),
  ).toHaveText(["Del día", "Corriente", "Ejecutivo", "Especial", "Desayuno"]);
  await expect(
    page.getByText("No hay productos en esta categoría.", { exact: true }),
  ).toBeVisible();
  await expect(cafeteria(page)).toHaveAttribute("aria-checked", "false");
  await cafeteria(page).click();
  await expect(cafeteria(page)).toHaveAttribute("aria-checked", "true");
  await expect(cafeteria(page)).toBeEnabled();
  await product(page).click();
  await expect(product(page)).toHaveAttribute("aria-checked", "true");
  await expect(product(page)).toBeEnabled();
  await page.reload();
  await enter(page);
  await expect(cafeteria(page)).toHaveAttribute("aria-checked", "true");
  await expect(product(page)).toHaveAttribute("aria-checked", "true");
  await product(page).click();
  await expect(product(page)).toHaveAttribute("aria-checked", "false");
  await expect(product(page)).toBeEnabled();
  await cafeteria(page).click();
  await expect(cafeteria(page)).toHaveAttribute("aria-checked", "false");
  await expect(cafeteria(page)).toBeEnabled();
  await page.reload();
  await enter(page);
  await expect(product(page)).toHaveAttribute("aria-checked", "false");
  await expect(cafeteria(page)).toHaveAttribute("aria-checked", "false");
  await page.getByRole("button", { name: "Pedidos", exact: true }).click();
  await expect(
    page.getByText("Gestión de pedidos", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Estudiante de prueba", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("search")).toBeVisible();
  await enter(page);
  expect((await audit(page)).directBusinessReads).toBe(0);
});

test("photos retain a 3:2 space, missing and failed images use placeholders", async ({
  page,
}) => {
  await login(page);
  await enter(page);
  const photo = page.getByRole("article", {
    name: "Almuerzo corriente",
    exact: true,
  });
  const image = photo.getByRole("img", {
    name: "Almuerzo corriente",
    exact: true,
  });
  await image.scrollIntoViewIfNeeded();
  await expect(image).toBeVisible();
  await expect(image).toHaveJSProperty("complete", true);
  expect(
    await image.evaluate(
      (element) => (element as HTMLImageElement).naturalWidth,
    ),
  ).toBeGreaterThan(0);
  const area = await image.locator("..").boundingBox();
  expect(area!.width / area!.height).toBeCloseTo(1.5, 1);
  const missing = page.getByRole("article", {
    name: "Segundo producto",
    exact: true,
  });
  await missing.scrollIntoViewIfNeeded();
  await expect(missing.getByText("Sin imagen", { exact: true })).toBeVisible();
  const failed = page.getByRole("article", {
    name: "Corriente tres",
    exact: true,
  });
  await failed.scrollIntoViewIfNeeded();
  await expect(failed.getByText("Sin imagen", { exact: true })).toBeVisible();
  const safeRemote = page.getByRole("article", {
    name: "Desayuno",
    exact: true,
  });
  await safeRemote.scrollIntoViewIfNeeded();
  await expect(
    safeRemote.getByText("Sin imagen", { exact: true }),
  ).toBeVisible();
});

test("stale 409 refreshes the day and flags without replaying the previous intent", async ({
  page,
}) => {
  await login(page);
  await enter(page);
  await expect(product(page)).toBeEnabled();
  await configure(page, { mode: "stale" });
  await product(page).click();
  await expect(
    page.getByRole("status").filter({
      hasText: "El día de operación cambió. Actualizamos la disponibilidad.",
    }),
  ).toBeVisible();
  await expect(page.locator("time")).toHaveAttribute("datetime", "2026-10-14");
  await expect(product(page)).toHaveAttribute("aria-checked", "false");
  const result = await audit(page);
  expect(result.puts).toHaveLength(1);
  expect(result.puts[0].day).toBe("2026-10-13");
  expect(result.puts[0].body).toEqual({ available: true });
});

test("recoverable initial 503 retains session, offers retry and leaves orders independent", async ({
  page,
}) => {
  await login(page);
  const cookies = (await page.context().cookies()).filter((cookie) =>
    cookie.name.startsWith("sb-"),
  );
  await configure(page, { mode: "get503" });
  await enter(page);
  await expect(availability(page).getByRole("alert")).toContainText(
    "no está disponible en este momento",
  );
  await expect(page.getByRole("switch")).toHaveCount(0);
  expect(
    (await page.context().cookies()).filter((cookie) =>
      cookie.name.startsWith("sb-"),
    ),
  ).toEqual(cookies);
  await expect(page).toHaveURL(/\/worker$/);
  await configure(page, { mode: null });
  await page.getByRole("button", { name: "Reintentar", exact: true }).click();
  await expect(product(page)).toBeEnabled();
  await page.getByRole("button", { name: "Pedidos", exact: true }).click();
  await expect(
    page.getByText("Estudiante de prueba", { exact: true }),
  ).toBeVisible();
});

test("inactive cafeteria permits close and disable but prevents opening or enabling", async ({
  page,
}) => {
  await configure(page, { active: false, open: true, available: true });
  await login(page);
  await enter(page);
  await expect(page.getByText(/administrativamente inactiva/)).toBeVisible();
  await expect(cafeteria(page)).toBeEnabled();
  await expect(product(page)).toBeEnabled();
  await expect(
    page.getByRole("switch", {
      name: "Disponibilidad de Segundo producto",
      exact: true,
    }),
  ).toBeDisabled();
  await product(page).click();
  await expect(product(page)).toHaveAttribute("aria-checked", "false");
  await expect(product(page)).toBeDisabled();
  await expect(
    page.getByRole("article", { name: "Almuerzo corriente", exact: true }),
  ).toHaveAttribute("aria-busy", "false");
  await cafeteria(page).click();
  await expect(cafeteria(page)).toHaveAttribute("aria-checked", "false");
  await expect(cafeteria(page)).toBeDisabled();
  await expect(cafeteriaSummary(page)).toHaveAttribute("aria-busy", "false");
  expect((await audit(page)).puts.map((entry) => entry.body)).toEqual([
    { available: false },
    { open: false },
  ]);
});

for (const mode of ["iteminactive", "notfound"] as const) {
  test(`${mode} refresh removes the inaccessible item with safe feedback`, async ({
    page,
  }) => {
    await login(page);
    await enter(page);
    await expect(product(page)).toBeEnabled();
    await configure(page, { mode });
    await product(page).click();
    await expect(product(page)).toHaveCount(0);
    await expect(
      page.getByRole("status").filter({
        hasText:
          mode === "notfound"
            ? "ya no está disponible"
            : "El producto está inactivo",
      }),
    ).toBeVisible();
    expect((await audit(page)).puts).toHaveLength(1);
    await expect(page.locator("body")).not.toContainText("PRIVATE");
  });
}

test("administrative conflict refreshes cafeteria activity without retrying opening", async ({
  page,
}) => {
  await login(page);
  await enter(page);
  await expect(cafeteria(page)).toBeEnabled();
  await configure(page, { mode: "cafinactive" });
  await cafeteria(page).click();
  await expect(cafeteria(page)).toHaveAttribute("aria-checked", "false");
  await expect(cafeteria(page)).toBeDisabled();
  await expect(product(page)).toBeDisabled();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "administrativamente inactiva" }),
  ).toBeVisible();
  expect((await audit(page)).puts).toHaveLength(1);
});

test("failed product save keeps session and synchronizes before an explicit new attempt", async ({
  page,
}) => {
  await login(page);
  await enter(page);
  await expect(product(page)).toBeEnabled();
  const cookies = (await page.context().cookies()).filter((cookie) =>
    cookie.name.startsWith("sb-"),
  );
  await configure(page, { mode: "put503" });
  await product(page).click();
  await expect(availability(page).getByRole("alert")).toContainText(
    "no está disponible en este momento",
  );
  await expect(product(page)).toHaveAttribute("aria-checked", "false");
  await expect(product(page)).toBeEnabled();
  expect((await audit(page)).puts).toHaveLength(1);
  expect(
    (await page.context().cookies()).filter((cookie) =>
      cookie.name.startsWith("sb-"),
    ),
  ).toEqual(cookies);
  await configure(page, { mode: null });
  await product(page).click();
  await expect(product(page)).toHaveAttribute("aria-checked", "true");
  expect((await audit(page)).puts).toHaveLength(2);
});

test("two product saves update optimistically and remain independent until each confirmation", async ({
  page,
}) => {
  await login(page);
  await enter(page);
  const pending = await holdMutation(page, `${root}/items/${itemId}`);
  try {
    await product(page).click();
    await expect(product(page)).toHaveAttribute("aria-checked", "true");
    await pending.arrived;
    await expect(product(page)).toBeDisabled();
    await expect(page.getByText("Guardando…", { exact: true })).toBeVisible();
    const other = page.getByRole("switch", {
      name: "Disponibilidad de Segundo producto",
      exact: true,
    });
    await other.click();
    await expect(other).toHaveAttribute("aria-checked", "true");
    await expect(other).toBeEnabled();
    await expect(product(page)).toBeDisabled();
    pending.release();
    await expect(product(page)).toHaveAttribute("aria-checked", "true");
    await expect(product(page)).toBeEnabled();
  } finally {
    await pending.cleanup();
  }
  expect((await audit(page)).puts.map((entry) => entry.path)).toEqual([
    `${root}/items/${itemId}`,
    `${root}/items/${secondId}`,
  ]);
});

test("cafeteria open and close appear immediately with discrete saving feedback until confirmation", async ({
  page,
}) => {
  await login(page);
  await enter(page);
  await expect(cafeteria(page)).toBeEnabled();
  for (const open of [true, false]) {
    const pending = await holdMutation(page, `${root}/cafeteria-state`);
    try {
      await cafeteria(page).click();
      await expect(cafeteria(page)).toHaveAttribute(
        "aria-checked",
        String(open),
      );
      await pending.arrived;
      await expect(cafeteria(page)).toBeDisabled();
      await expect(cafeteriaSummary(page).getByRole("status")).toHaveText(
        "Guardando…",
      );
      await expect(product(page)).toBeEnabled();
      pending.release();
      await expect(cafeteria(page)).toBeEnabled();
      await expect(cafeteria(page)).toHaveAttribute(
        "aria-checked",
        String(open),
      );
    } finally {
      await pending.cleanup();
    }
  }
  expect((await audit(page)).puts.map((entry) => entry.body)).toEqual([
    { open: true },
    { open: false },
  ]);
});

test("cafeteria 503 rolls back its optimistic closure and preserves session for an explicit retry", async ({
  page,
}) => {
  await configure(page, { open: true, mode: "put503" });
  await login(page);
  await enter(page);
  await expect(cafeteria(page)).toBeEnabled();
  const cookies = (await page.context().cookies()).filter((cookie) =>
    cookie.name.startsWith("sb-"),
  );
  const pending = await holdMutation(page, `${root}/cafeteria-state`);
  try {
    await cafeteria(page).click();
    await expect(cafeteria(page)).toHaveAttribute("aria-checked", "false");
    await pending.arrived;
    await expect(cafeteria(page)).toBeDisabled();
    pending.release();
    await expect(cafeteria(page)).toHaveAttribute("aria-checked", "true");
    await expect(cafeteria(page)).toBeEnabled();
    await expect(cafeteriaSummary(page).getByRole("alert")).toContainText(
      "no está disponible en este momento",
    );
  } finally {
    await pending.cleanup();
  }
  expect((await audit(page)).puts).toHaveLength(1);
  expect(
    (await page.context().cookies()).filter((cookie) =>
      cookie.name.startsWith("sb-"),
    ),
  ).toEqual(cookies);
  await configure(page, { mode: null });
  await cafeteria(page).click();
  await expect(cafeteria(page)).toBeEnabled();
  await expect(cafeteria(page)).toHaveAttribute("aria-checked", "false");
  expect((await audit(page)).puts).toHaveLength(2);
});

test("a network failure rolls back an optimistic product without replaying the failed PUT", async ({
  page,
}) => {
  await login(page);
  await enter(page);
  await expect(product(page)).toBeEnabled();
  const pending = await holdMutation(page, `${root}/items/${itemId}`, true);
  try {
    await product(page).click();
    await expect(product(page)).toHaveAttribute("aria-checked", "true");
    await pending.arrived;
    pending.release();
    await expect(product(page)).toHaveAttribute("aria-checked", "false");
    await expect(product(page)).toBeEnabled();
    await expect(availability(page).getByRole("alert")).toContainText(
      "no está disponible en este momento",
    );
  } finally {
    await pending.cleanup();
  }
  expect((await audit(page)).puts).toHaveLength(0);
  await expect(page).toHaveURL(/\/worker$/);
});

for (const viewport of [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1366, height: 768 },
]) {
  test(`native carousel, keyboard and layout work at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await login(page);
    await enter(page);
    const rail = page.getByRole("region", {
      name: "Productos de Corriente",
      exact: true,
    });
    const next = page.getByRole("button", {
      name: "Siguiente en Corriente",
      exact: true,
    });
    const previous = page.getByRole("button", {
      name: "Anterior en Corriente",
      exact: true,
    });
    await expect(previous).toBeDisabled();
    await expect(next).toBeEnabled();
    const single = page.getByRole("article", {
      name: "Producto del día",
      exact: true,
    });
    const singleBounds = await single.boundingBox();
    expect(singleBounds!.width).toBeGreaterThanOrEqual(220);
    expect(singleBounds!.width).toBeLessThanOrEqual(250);
    const singleRail = await page
      .getByRole("region", { name: "Productos de Del día", exact: true })
      .boundingBox();
    expect(
      Math.abs(
        singleBounds!.x +
          singleBounds!.width / 2 -
          singleRail!.x -
          singleRail!.width / 2,
      ),
    ).toBeLessThanOrEqual(1);
    await expect(cafeteriaSummary(page)).toContainText("Estado administrativo");
    await expect(cafeteriaSummary(page)).toContainText("Activa");
    await expect(
      page.getByRole("region", { name: "Especial", exact: true }),
    ).toContainText("No hay productos");
    await capture(page, viewport.width, "initial");
    await rail.scrollIntoViewIfNeeded();
    if (viewport.width === 390) {
      const railBounds = await rail.boundingBox();
      const secondBounds = await page
        .getByRole("article", { name: "Segundo producto", exact: true })
        .boundingBox();
      expect(secondBounds!.x).toBeLessThan(railBounds!.x + railBounds!.width);
      expect(secondBounds!.x + secondBounds!.width).toBeGreaterThan(
        railBounds!.x + railBounds!.width,
      );
    }
    await capture(page, viewport.width, "products");
    await next.click();
    await expect
      .poll(() => rail.evaluate((element) => element.scrollLeft))
      .toBeGreaterThan(0);
    await rail.focus();
    await page.keyboard.press("Home");
    await expect
      .poll(() => rail.evaluate((element) => element.scrollLeft))
      .toBe(0);
    await page.keyboard.press("ArrowRight");
    await expect
      .poll(() => rail.evaluate((element) => element.scrollLeft))
      .toBeGreaterThan(0);
    await page.keyboard.press("End");
    await expect(next).toBeDisabled();
    await expect(previous).toBeEnabled();
    await product(page).focus();
    await page.keyboard.press("Space");
    await expect(product(page)).toHaveAttribute("aria-checked", "true");
    await expect(product(page)).toBeEnabled();
    const breakfast = page.getByRole("heading", {
      name: "Desayuno",
      exact: true,
      level: 3,
    });
    await breakfast.scrollIntoViewIfNeeded();
    await expect(breakfast).toBeVisible();
    const nav = await page
      .getByRole("navigation", { name: "Navegación principal" })
      .boundingBox();
    expect(nav!.y + nav!.height).toBeLessThanOrEqual(viewport.height);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(viewport.width);
    const content = await page.locator(".worker-main").boundingBox();
    expect(content!.width).toBeLessThanOrEqual(1320);
    expect(content!.x).toBeGreaterThanOrEqual(0);
    expect(
      Math.abs(content!.x + content!.width / 2 - viewport.width / 2),
    ).toBeLessThanOrEqual(1);
  });
}

import { test, expect as baseExpect, type Page } from "@playwright/test";

// Pages compile on their first visit in the development server.
const expect = baseExpect.configure({ timeout: 20_000 });
const PROVIDER = "http://127.0.0.1:3101";
// The development server compiles each new route on its first request.
test.describe.configure({ timeout: 90_000 });

test.skip(
  !!process.env.PLAYWRIGHT_BASE_URL,
  "Super admin fixtures require the controlled local test servers.",
);

async function control(page: Page, config: Record<string, unknown>) {
  const response = await page.request.post(`${PROVIDER}/__test/super-admin`, {
    data: config,
  });
  expect(response.ok()).toBe(true);
  return (await response.json()) as {
    mutations: { action: string; body: Record<string, unknown> }[];
    auditGets: string[];
  };
}

async function login(page: Page) {
  await page.goto("/panel/login");
  await page
    .getByLabel("Usuario o correo institucional", { exact: true })
    .fill("superadmin@example.invalid");
  await page.getByLabel("Contraseña", { exact: true }).fill("UnaClave8");
  await page
    .getByRole("button", { name: "Iniciar sesión", exact: true })
    .click();
  // The first visit compiles the panel in the development server.
  await expect(page).toHaveURL(/\/super-admin$/, { timeout: 60_000 });
}

/** The page never scrolls sideways on the phone; only the table card does. */
async function noSidewaysScroll(page: Page) {
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    ),
  ).toBe(0);
}

test.beforeEach(async ({ page }) => {
  await control(page, { reset: true });
});

test("the listing uses plain words: plurals, visibility, billing and administrator", async ({
  page,
}) => {
  await login(page);
  await expect(page.getByRole("heading", { name: "Cafeterías" })).toBeVisible();
  await expect(
    page.getByText(
      "2 cafeterías en 1 sede de 1 institución · 1 visible para los clientes.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("columnheader", { name: "Administrador" }),
  ).toBeVisible();
  await expect(page.getByText("Sin administrador activo")).toBeVisible();
  await expect(
    page.getByText(/SQL|ADMIN activo|Suscripción activa/),
  ).toHaveCount(0);
  await expect(
    page.getByRole("row", { name: /Cafetería Norte/ }).getByText("Oculta"),
  ).toBeVisible();
});

test("hiding asks first, keeps orders in progress and records the change", async ({
  page,
}) => {
  await login(page);
  await page
    .getByRole("button", { name: "Gestionar Cafetería Central" })
    .click();
  const settings = page.getByRole("region", { name: "Cafetería Central" });
  await expect(
    settings.getByText("Aún no hay cambios registrados."),
  ).toBeVisible();
  const toggle = settings.getByRole("switch", {
    name: "Visible para los clientes",
  });
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await noSidewaysScroll(page);

  await toggle.click();
  const dialog = page.getByRole("dialog", {
    name: "¿Ocultar Cafetería Central?",
  });
  await expect(
    dialog.getByText(
      "Los pedidos en curso se terminarán de atender. Los clientes no podrán hacer pedidos nuevos en esta cafetería.",
    ),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Cancelar" }).click();
  await expect(dialog).toBeHidden();
  expect((await control(page, {})).mutations).toEqual([]);

  await toggle.click();
  await dialog.getByRole("button", { name: "Ocultar cafetería" }).click();
  await expect(settings.getByRole("status")).toHaveText("Cambios guardados.");
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect(
    page.getByRole("row", { name: /Cafetería Central/ }).getByText("Oculta"),
  ).toBeVisible();
  await expect(
    settings.getByText("Visibilidad: Visible → Oculta"),
  ).toBeVisible();
  await expect(settings.getByText(/Dueño del repositorio ·/)).toBeVisible();
  const { mutations } = await control(page, {});
  expect(mutations).toEqual([
    { action: "visibility", body: { visible: false, expectedVisible: true } },
  ]);
});

test("showing a cafeteria without an administrator explains why next to the switch", async ({
  page,
}) => {
  await login(page);
  await page.getByRole("button", { name: "Gestionar Cafetería Norte" }).click();
  const settings = page.getByRole("region", { name: "Cafetería Norte" });
  const toggle = settings.getByRole("switch", {
    name: "Visible para los clientes",
  });
  await toggle.click();
  await expect(
    settings.getByRole("alert").filter({
      hasText:
        "Asigna un administrador activo antes de hacer visible esta cafetería.",
    }),
  ).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  expect((await control(page, {})).mutations).toEqual([]);
});

test("billing: a fee in whole pesos, an optional monthly amount and the fixed note", async ({
  page,
}) => {
  await login(page);
  await page
    .getByRole("button", { name: "Gestionar Cafetería Central" })
    .click();
  const settings = page.getByRole("region", { name: "Cafetería Central" });
  await expect(
    settings.getByText(
      "UniFood no cobra desde la aplicación; esto solo registra el acuerdo.",
    ),
  ).toBeVisible();
  const model = settings.getByLabel("Modelo de cobro");
  await expect(settings.getByLabel("Monto mensual (COP)")).toHaveCount(0);

  await model.selectOption({ label: "Comisión por pedido" });
  const fee = settings.getByLabel("Comisión por pedido (COP)");
  await fee.fill("12,5");
  await settings.getByRole("button", { name: "Guardar" }).click();
  await expect(
    settings.getByText("Escribe una comisión entera entre $1 y $1.000.000."),
  ).toBeVisible();
  expect((await control(page, {})).mutations).toEqual([]);

  await fee.fill("1.000");
  await settings.getByRole("button", { name: "Guardar" }).click();
  await expect(settings.getByRole("status")).toHaveText("Cambios guardados.");
  await expect(
    page
      .getByRole("row", { name: /Cafetería Central/ })
      .getByText("Comisión de $1.000 por pedido"),
  ).toBeVisible();
  await expect(
    settings.getByText("Cobro: Sin cobro → Comisión de $1.000 por pedido"),
  ).toBeVisible();

  await model.selectOption({ label: "Suscripción" });
  await expect(settings.getByLabel("Comisión por pedido (COP)")).toHaveCount(0);
  await settings.getByLabel("Monto mensual (COP)").fill("250000");
  await settings.getByRole("button", { name: "Guardar" }).click();
  await expect(
    page
      .getByRole("row", { name: /Cafetería Central/ })
      .getByText("Suscripción de $250.000 al mes"),
  ).toBeVisible();
  const { mutations } = await control(page, {});
  expect(mutations.map((entry) => entry.body)).toEqual([
    {
      model: "PER_ORDER_FEE",
      perOrderFeeCop: 1000,
      subscriptionFeeCop: null,
      expectedVersion: 0,
    },
    {
      model: "SUBSCRIPTION",
      perOrderFeeCop: null,
      subscriptionFeeCop: 250000,
      expectedVersion: 1,
    },
  ]);
});

test("a concurrent change and a temporary failure show fixed messages next to the form", async ({
  page,
}) => {
  await login(page);
  await page
    .getByRole("button", { name: "Gestionar Cafetería Central" })
    .click();
  const settings = page.getByRole("region", { name: "Cafetería Central" });
  await settings
    .getByLabel("Modelo de cobro")
    .selectOption({ label: "Suscripción" });
  await control(page, { mode: "conflict" });
  await settings.getByRole("button", { name: "Guardar" }).click();
  await expect(
    settings.getByText(
      "Otra persona cambió esta cafetería. Revisa el valor actual e inténtalo de nuevo.",
    ),
  ).toBeVisible();
  await settings
    .getByLabel("Modelo de cobro")
    .selectOption({ label: "Suscripción" });
  await control(page, { mode: "503" });
  await settings.getByRole("button", { name: "Guardar" }).click();
  await expect(
    settings.getByText("No pudimos guardar el cambio. Inténtalo de nuevo."),
  ).toBeVisible();
  await expect(settings.getByRole("status")).toHaveText("");
});

test("a manual SQL change shows as such in the history", async ({ page }) => {
  await control(page, { manualSql: true });
  await login(page);
  await page
    .getByRole("button", { name: "Gestionar Cafetería Central" })
    .click();
  const settings = page.getByRole("region", { name: "Cafetería Central" });
  await expect(settings.getByText("Cobro inicial: Sin cobro")).toBeVisible();
  await expect(settings.getByText(/Cambio manual \(SQL\) ·/)).toBeVisible();
  // The browser never chooses how many entries Spring returns.
  expect((await control(page, {})).auditGets).toEqual(["?limit=20"]);
});

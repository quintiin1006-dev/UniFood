import { test, expect as baseExpect, type Page } from "@playwright/test";

// «Mi pedido» polls every 5 s, so a transition shows up within a few seconds: every wait below
// is an auto-retrying expectation, never a fixed pause.
const expect = baseExpect.configure({ timeout: 25_000 });
test.skip(
  !!process.env.PLAYWRIGHT_BASE_URL,
  "Requires controlled local providers.",
);

const provider = "http://127.0.0.1:3101";
const email = "clientflow@example.invalid";

type Flow = {
  reset?: boolean;
  order?: string | null;
  status?: string;
  fields?: Record<string, unknown>;
  historyCount?: number;
  failCurrent?: boolean;
};

async function flow(page: Page, config: Flow) {
  const response = await page.request.post(`${provider}/__test/client-flow`, {
    data: { email, ...config },
  });
  expect(response.ok()).toBe(true);
}

async function login(page: Page) {
  await page.goto("/login");
  await page
    .getByLabel("Usuario o correo institucional", { exact: true })
    .fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill("UnaClave8");
  await page
    .getByRole("button", { name: "Iniciar sesión", exact: true })
    .click();
  await expect(page).toHaveURL(/\/cuenta$/);
}

test.beforeEach(async ({ page }) => {
  await flow(page, { reset: true });
  await login(page);
});

test("pedido → seguimiento → cancelar", async ({ page }) => {
  await flow(page, { order: "PENDING" });
  await page.goto("/cuenta/pedido");
  await expect(
    page.getByRole("heading", { name: "Pedido enviado" }),
  ).toBeVisible();
  await expect(page.getByText("Almuerzo del día")).toBeVisible();
  await expect(page.getByText(/efectivo en caja/)).toBeVisible();

  await page.getByRole("button", { name: "Cancelar pedido" }).click();
  const dialog = page.getByRole("dialog", { name: "¿Cancelar tu pedido?" });
  await expect(dialog).toBeVisible();
  // Keeping the order is the focused default; nothing is cancelled by closing the dialog.
  await expect(
    dialog.getByRole("button", { name: "Mantener pedido" }),
  ).toBeFocused();
  await dialog.getByRole("button", { name: "Sí, cancelar pedido" }).click();

  await expect(
    page.getByRole("heading", { name: "Cancelaste tu pedido" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Cancelar pedido" }),
  ).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Ver el menú" })).toBeVisible();
});

test("el cancelar desaparece y el error es claro cuando ya está en preparación", async ({
  page,
}) => {
  await flow(page, { order: "PENDING" });
  await page.goto("/cuenta/pedido");
  await page.getByRole("button", { name: "Cancelar pedido" }).click();
  // The kitchen starts before the client confirms.
  await flow(page, { status: "PREPARING" });
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Sí, cancelar pedido" }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "ya no se puede cancelar",
  );
  await dialog.getByRole("button", { name: "Cerrar" }).click();
  await expect(
    page.getByRole("heading", { name: "Están preparando tu pedido" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Cancelar pedido" }),
  ).toHaveCount(0);
});

test("avisos al pasar a preparación y a listo, con el título de la pestaña", async ({
  page,
}) => {
  await flow(page, {
    order: "PENDING",
    fields: {
      note: "Sin cebolla",
      requestedPickupAt: "2026-11-20T18:30:00Z",
    },
  });
  await page.goto("/cuenta/pedido");
  await expect(page.getByText("Sin cebolla")).toBeVisible();
  await expect(page.getByText("13:30")).toBeVisible();
  await expect(page).toHaveTitle("Mi pedido | UniFood");

  await flow(page, { status: "PREPARING" });
  // The notice is a polite status, so a screen reader announces it without taking the focus.
  const notice = (text: string) =>
    page.getByRole("status").filter({ hasText: text });
  await expect(notice("Tu pedido está en preparación.")).toBeVisible();
  await expect(page).toHaveTitle("Preparando tu pedido | UniFood");

  await flow(page, { status: "READY" });
  await expect(notice("Tu pedido está listo. Pasa a recogerlo.")).toBeVisible();
  await expect(page).toHaveTitle("Tu pedido está listo | UniFood");
  await expect(
    page.getByRole("heading", { name: "Tu pedido está listo" }),
  ).toBeVisible();

  await flow(page, { status: "CALLED" });
  await expect(
    page.getByRole("heading", { name: "Te están llamando" }),
  ).toBeVisible();
  await expect(
    notice("Te están llamando: pasa a recoger tu pedido."),
  ).toBeVisible();

  // Leaving the screen gives the tab its own title back.
  await page.getByRole("link", { name: "Mi perfil" }).click();
  await expect(page).toHaveURL(/\/cuenta\/perfil/);
  await expect(page).not.toHaveTitle(/Tu pedido está listo/);
});

test("al terminar el pedido se ve cómo acabó", async ({ page }) => {
  await flow(page, { order: "READY" });
  await page.goto("/cuenta/pedido");
  await expect(
    page.getByRole("heading", { name: "Tu pedido está listo" }),
  ).toBeVisible();
  await flow(page, { status: "DELIVERED" });
  const ended = page.getByRole("heading", { name: "Pedido entregado" });
  await expect(ended).toBeVisible();
  await expect(ended).toBeFocused();
  await expect(page).not.toHaveTitle(/Tu pedido está listo/);

  // A new order, then the cafeteria rejects it: the reason is shown.
  await flow(page, { order: "PENDING" });
  await expect(
    page.getByRole("heading", { name: "Pedido enviado" }),
  ).toBeVisible();
  await flow(page, {
    status: "CANCELLED",
    fields: { cancellationSource: "WORKER", rejectionReason: "Sin stock" },
  });
  await expect(
    page.getByRole("heading", { name: "La cafetería rechazó tu pedido" }),
  ).toBeVisible();
  await expect(page.getByText("Motivo: Sin stock")).toBeVisible();
});

test("sin pedido activo: estado vacío con acceso al menú", async ({ page }) => {
  await flow(page, { order: null });
  await page.goto("/cuenta/pedido");
  await expect(page.getByText("No tienes un pedido activo")).toBeVisible();
  await expect(page.getByRole("link", { name: "Ver el menú" })).toHaveAttribute(
    "href",
    "/cuenta",
  );
});

test("sondea con ETag y recibe 304 mientras nada cambia", async ({ page }) => {
  await flow(page, { order: "PENDING" });
  const first = page.waitForResponse(
    (r) => r.url().includes("/api/me/orders/current") && r.status() === 200,
  );
  await page.goto("/cuenta/pedido");
  const initial = await first;
  expect(initial.headers()["etag"]).toBeTruthy();
  const unchanged = await page.waitForResponse(
    (r) => r.url().includes("/api/me/orders/current") && r.status() === 304,
  );
  expect(unchanged.status()).toBe(304);
});

test("sin conexión: conserva el último pedido, avisa y se recupera", async ({
  page,
}) => {
  await flow(page, { order: "PREPARING" });
  await page.goto("/cuenta/pedido");
  await expect(
    page.getByRole("heading", { name: "Están preparando tu pedido" }),
  ).toBeVisible();
  await flow(page, { failCurrent: true });
  await expect(page.getByText(/Sin conexión\. Reintentando/)).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Están preparando tu pedido" }),
  ).toBeVisible();
  await flow(page, { failCurrent: false });
  await expect(page.getByText(/Sin conexión\. Reintentando/)).toHaveCount(0);
});

test("el interruptor de sonido se guarda en el navegador", async ({ page }) => {
  await flow(page, { order: "PENDING" });
  await page.goto("/cuenta/pedido");
  const sound = page.getByRole("switch", { name: "Sonido de avisos" });
  await expect(sound).toBeChecked();
  await sound.click();
  await expect(sound).not.toBeChecked();
  await page.reload();
  await expect(
    page.getByRole("switch", { name: "Sonido de avisos" }),
  ).not.toBeChecked();
});

test("historial: más de una página, «Cargar más» y detalle de solo lectura", async ({
  page,
}) => {
  await flow(page, { order: null, historyCount: 25 });
  await page.goto("/cuenta/pedido");
  const rows = page.getByRole("button", { name: /Cafetería Central/ });
  await expect(rows).toHaveCount(20);
  await page.getByRole("button", { name: "Cargar más" }).click();
  await expect(rows).toHaveCount(25);
  await expect(page.getByRole("button", { name: "Cargar más" })).toHaveCount(0);
  await expect(page.getByText(/repetir/i)).toHaveCount(0);

  await rows.first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Almuerzo del día")).toBeVisible();
  await expect(dialog.getByText("Pedido entregado.")).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: /cancelar|repetir/i }),
  ).toHaveCount(0);
  await dialog.getByRole("button", { name: "Cerrar" }).click();
  await expect(dialog).toHaveCount(0);
});

test("historial vacío", async ({ page }) => {
  await flow(page, { order: null, historyCount: 0 });
  await page.goto("/cuenta/pedido");
  await expect(
    page.getByText("Aún no tienes pedidos anteriores"),
  ).toBeVisible();
  await expect(page.getByText("No tienes un pedido activo")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Ver el menú" }).first(),
  ).toBeVisible();
});

test("objetivos táctiles de al menos 44 px", async ({ page }) => {
  await flow(page, { order: "PENDING", historyCount: 3 });
  await page.goto("/cuenta/pedido");
  const targets = [
    page.getByRole("switch", { name: "Sonido de avisos" }),
    page.getByRole("button", { name: "Cancelar pedido" }),
  ];
  for (const target of targets) {
    await expect(target).toBeVisible();
    const box = await target.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  await page.goto("/cuenta/pedido");
  const row = page.getByRole("button", { name: /Cafetería Central/ }).first();
  await expect(row).toBeVisible();
  expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44);
});

for (const width of [320, 390]) {
  test(`la barra tiene cuatro pestañas con área táctil de 44 px a ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 700 });
    await flow(page, { order: "PENDING" });
    await page.goto("/cuenta/pedido");
    const nav = page.getByRole("navigation", {
      name: "Navegación del estudiante",
    });
    const tabs = nav.getByRole("link");
    await expect(tabs).toHaveCount(4);
    for (const name of ["Inicio", "Pedido", "Carrito", "Perfil"])
      await expect(nav.getByRole("link", { name })).toBeVisible();
    for (const tab of await tabs.all()) {
      const box = await tab.boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    await expect(nav.getByRole("link", { name: "Pedido" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    // Four cells: nothing sticks out of the page.
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await expect(nav.getByRole("link", { name: "Historial" })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "Inicio" })).not.toHaveAttribute(
      "aria-current",
      "page",
    );
  });
}

test("las pantallas nuevas piden sesión y solo son del cliente", async ({
  browser,
  baseURL,
}) => {
  const anonymous = await browser.newContext({ baseURL });
  const page = await anonymous.newPage();
  for (const path of ["/cuenta/pedido", "/cuenta/historial"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login/);
  }
  await anonymous.close();
});

test("si la sesión vence durante el seguimiento no queda la pantalla vacía", async ({
  page,
}) => {
  await flow(page, { order: "PREPARING" });
  await page.goto("/cuenta/pedido");
  await expect(
    page.getByRole("heading", { name: "Están preparando tu pedido" }),
  ).toBeVisible();
  await page.context().clearCookies();
  const alert = page.getByRole("alert").filter({ hasText: "Tu sesión expiró" });
  await expect(alert).toBeVisible();
  await expect(
    alert.getByRole("link", { name: "Iniciar sesión" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Están preparando tu pedido" }),
  ).toHaveCount(0);
});

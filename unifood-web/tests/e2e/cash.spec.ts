import { test, expect as baseExpect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import {
  BACKEND_ERROR_MESSAGES,
  CASH_TEXTS,
} from "../../features/shared/messages";

// Cash register end to end (docs/decisiones.md §14): worker drawer, admin control and
// SUPER_ADMIN read-only, against the Spring stand-in of cash-backend-server.mjs on its own ports
// (playwright.cash.config.ts). Business rules are proven on PostgreSQL by
// CashSessionApiPostgresTest; this spec proves the screens, the BFF and the messages.
const expect = baseExpect.configure({ timeout: 20_000 });
test.skip(
  !!process.env.PLAYWRIGHT_BASE_URL,
  "Requires the controlled local cash fixture.",
);
test.describe.configure({ mode: "serial" });

const BACKEND = "http://127.0.0.1:8700";
const SHOTS =
  process.env.CASH_SCREENSHOTS ?? "C:/Users/juant/Desktop/capturas-caja";
const WIDE = { width: 1024, height: 768 };
const NARROW = { width: 390, height: 844 };

async function control(page: Page, action: string, data: object = {}) {
  const response = await page.request.post(`${BACKEND}/__test/cash/${action}`, {
    data,
  });
  expect(response.status()).toBe(200);
}

async function login(page: Page, email: string, landing: RegExp) {
  await page.goto("/panel/login");
  await page
    .getByLabel("Usuario o correo institucional", { exact: true })
    .fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill("UnaClave8");
  await page
    .getByRole("button", { name: "Iniciar sesión", exact: true })
    .click();
  await expect(page).toHaveURL(landing);
}

/** Same screen at 1024×768 (tablet) and 390 px wide (phone), outside the repository. */
async function shot(page: Page, name: string) {
  await mkdir(SHOTS, { recursive: true });
  for (const [label, size] of [
    ["1024x768", WIDE],
    ["390", NARROW],
  ] as const) {
    await page.setViewportSize(size);
    await page.waitForTimeout(150);
    await page.screenshot({
      path: `${SHOTS}/${name}-${label}.png`,
      fullPage: true,
    });
    await audit(page, `${name} ${label}`);
  }
  await page.setViewportSize(WIDE);
}

/**
 * Visual and accessibility audit of the cash region: icons of at least 20 real pixels (16 only
 * for the simple glyphs, which caja does not use), touch targets of at least 44 px, no horizontal
 * overflow and no overlapping controls.
 */
async function audit(page: Page, where: string) {
  const report = await page.evaluate(() => {
    const region =
      document.querySelector("[aria-labelledby='cash-title']") ??
      document.querySelector("main") ??
      document.body;
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return (
        r.width > 0 &&
        r.height > 0 &&
        style.visibility !== "hidden" &&
        style.display !== "none"
      );
    };
    const icons = [...region.querySelectorAll("svg")]
      .filter(visible)
      .map((svg) => {
        const r = svg.getBoundingClientRect();
        return {
          w: Math.round(r.width * 10) / 10,
          h: Math.round(r.height * 10) / 10,
        };
      })
      .filter((r) => r.w < 20 || r.h < 20);
    const controls = [
      ...region.querySelectorAll(
        "button, a[href], input[type='radio'] + *, label:has(input[type='radio'])",
      ),
    ]
      .filter(visible)
      .map((el) => ({
        el,
        r: el.getBoundingClientRect(),
        text: (el.textContent ?? "").trim().slice(0, 40),
      }));
    const small = controls
      .filter(({ r }) => r.height < 44 || r.width < 44)
      .map(
        ({ r, text }) =>
          `${text} ${Math.round(r.width)}×${Math.round(r.height)}`,
      );
    const overlaps: string[] = [];
    for (let i = 0; i < controls.length; i++)
      for (let j = i + 1; j < controls.length; j++) {
        const a = controls[i];
        const b = controls[j];
        if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
        const x = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
        const y = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
        if (x > 1 && y > 1) overlaps.push(`${a.text} / ${b.text}`);
      }
    return {
      icons,
      small,
      overlaps,
      overflow: document.documentElement.scrollWidth - window.innerWidth,
    };
  });
  expect(report.icons, `${where}: icons under 20 px`).toEqual([]);
  expect(report.small, `${where}: touch targets under 44 px`).toEqual([]);
  expect(report.overlaps, `${where}: overlapping controls`).toEqual([]);
  expect(report.overflow, `${where}: horizontal overflow`).toBeLessThanOrEqual(
    1,
  );
}

async function count(page: Page, quantities: Record<string, number>) {
  for (const [label, quantity] of Object.entries(quantities))
    await page.getByLabel(label, { exact: true }).fill(String(quantity));
}

async function openCash(page: Page) {
  await page.getByRole("button", { name: "Caja", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Caja", level: 2 }),
  ).toBeVisible();
}

const cash = (page: Page) => page.locator("[aria-labelledby='cash-title']");

test.beforeAll(async ({ request }) => {
  expect((await request.post(`${BACKEND}/__test/cash/reset`)).status()).toBe(
    200,
  );
});

test("WORKER opens the drawer, records movements and is warned of sales without a drawer", async ({
  page,
}) => {
  // Delivered before any drawer: a sale without a drawer.
  await control(page, "deliver", { total: 8000, secondsAgo: 120 });
  await login(page, "worker@example.invalid", /\/worker$/);
  await openCash(page);
  await expect(cash(page).getByText("Ventas sin caja")).toBeVisible();

  await cash(page).getByText("Desayuno", { exact: true }).click();
  await count(page, { "$50.000": 1 });
  await cash(page)
    .getByRole("button", { name: /Abrir caja con \$50\.000/ })
    .click();
  await expect(
    cash(page).getByRole("heading", { name: "Caja abierta" }),
  ).toBeVisible();

  await control(page, "deliver", { total: 13000 });
  await cash(page).getByRole("button", { name: "Actualizar caja" }).click();
  await expect(cash(page).getByText("$63.000")).toBeVisible(); // 50.000 + 13.000

  // Other income with its reason.
  await cash(page)
    .getByRole("button", { name: "Registrar movimiento" })
    .click();
  await cash(page).getByText("Otro ingreso", { exact: true }).click();
  await cash(page).getByLabel("Monto (COP)").fill("2000");
  await cash(page).getByLabel("Motivo").fill("Ajuste de vuelto");
  await cash(page)
    .getByRole("button", { name: /Registrar \$2\.000/ })
    .click();
  await expect(cash(page).getByText("Ajuste de vuelto")).toBeVisible();

  // An expense above the drawer is refused with the catalogue's message.
  await cash(page)
    .getByRole("button", { name: "Registrar movimiento" })
    .click();
  await cash(page).getByText("Egreso o retiro", { exact: true }).click();
  await cash(page).getByLabel("Monto (COP)").fill("90000");
  await cash(page).getByLabel("Motivo").fill("Retiro grande");
  await cash(page)
    .getByRole("button", { name: /Registrar \$90\.000/ })
    .click();
  await expect(
    cash(page).getByText(BACKEND_ERROR_MESSAGES.CASH_EXPENSE_EXCEEDS_BALANCE),
  ).toBeVisible();
  await cash(page).getByLabel("Monto (COP)").fill("5000");
  await cash(page).getByLabel("Motivo").fill("Compra de hielo");
  await cash(page)
    .getByRole("button", { name: /Registrar \$5\.000/ })
    .click();
  await expect(cash(page).getByText("Compra de hielo")).toBeVisible();
  // 50.000 + 13.000 + 2.000 − 5.000
  await expect(cash(page).getByText("$60.000")).toBeVisible();
  await shot(page, "01-caja-abierta");

  // Keyboard focus is visible on the drawer's actions.
  await cash(page).getByRole("button", { name: "Cerrar caja" }).focus();
  const outline = await page.evaluate(() => {
    const style = getComputedStyle(document.activeElement as Element);
    return `${style.outlineStyle} ${style.outlineWidth}`;
  });
  expect(outline).not.toMatch(/^none|0px$/);
});

test("WORKER closes with a shortage: preview, mandatory note of 10 characters and receipt", async ({
  page,
}) => {
  await login(page, "worker@example.invalid", /\/worker$/);
  await openCash(page);
  await cash(page).getByRole("button", { name: "Cerrar caja" }).click();
  await expect(cash(page).getByText("Paso 1 de")).toBeVisible();
  await count(page, { "$50.000": 1, "$2.000": 4 }); // 58.000 against 60.000
  await cash(page).getByRole("button", { name: "Continuar" }).click();
  // Server-side preview.
  await expect(cash(page).getByText("Faltante")).toBeVisible();
  await expect(cash(page).getByText("-$2.000")).toBeVisible();
  await cash(page).getByRole("button", { name: "Continuar" }).click();
  const note = cash(page).getByLabel("Nota del cierre (obligatoria)");
  await note.fill("corta");
  await cash(page).getByRole("button", { name: "Continuar" }).click();
  await expect(
    cash(page)
      .getByText(/al menos 10 caracteres/)
      .first(),
  ).toBeVisible();
  await note.fill("Faltan 2.000 de un vuelto mal dado");
  await shot(page, "02-cierre-descuadre");
  await cash(page).getByRole("button", { name: "Continuar" }).click();
  await expect(cash(page).getByText(CASH_TEXTS.confirmClose)).toBeVisible();
  await cash(page).getByRole("button", { name: "Cerrar caja" }).click();
  await expect(
    cash(page).getByText("Comprobante de cierre de caja"),
  ).toBeVisible();
  await expect(cash(page).getByText(/-\$2\.000 · Faltante/)).toBeVisible();
  await expect(cash(page).getByText(CASH_TEXTS.notInvoice)).toBeVisible();
  await shot(page, "03-caja-cerrada");
});

test("WORKER cannot reopen the same shift and day, then closes another shift exactly", async ({
  page,
}) => {
  await login(page, "worker@example.invalid", /\/worker$/);
  await openCash(page);
  await cash(page).getByText("Desayuno", { exact: true }).click();
  await count(page, { "$20.000": 1 });
  await cash(page)
    .getByRole("button", { name: /Abrir caja con/ })
    .click();
  await expect(
    cash(page).getByText(BACKEND_ERROR_MESSAGES.CASH_SHIFT_ALREADY_USED),
  ).toBeVisible();

  await cash(page).getByText("Almuerzo", { exact: true }).click();
  await cash(page)
    .getByRole("button", { name: /Abrir caja con \$20\.000/ })
    .click();
  await expect(
    cash(page).getByRole("heading", { name: "Caja abierta" }),
  ).toBeVisible();
  await cash(page).getByRole("button", { name: "Cerrar caja" }).click();
  await count(page, { "$20.000": 1 });
  await cash(page).getByRole("button", { name: "Continuar" }).click();
  await expect(cash(page).getByText("Cuadra")).toBeVisible();
  // Without a difference the note step is skipped.
  await cash(page).getByRole("button", { name: "Continuar" }).click();
  await expect(cash(page).getByText("Paso 3 de 3")).toBeVisible();
  await cash(page).getByRole("button", { name: "Cerrar caja" }).click();
  await expect(
    cash(page).getByText("Comprobante de cierre de caja"),
  ).toBeVisible();
});

test("ADMIN sees its closures, sales without a drawer, exports CSV and sets the tolerance", async ({
  page,
}) => {
  await login(page, "admin@example.invalid", /\/admin$/);
  await page.goto("/admin/caja");
  await expect(
    page.getByRole("heading", { name: "Cierres de caja" }),
  ).toBeVisible();
  const rows = page.locator("table tbody tr");
  await expect(rows).toHaveCount(2);
  await expect(page.getByText("Ventas sin caja hoy")).toBeVisible();
  await expect(
    page.getByText(/1 pedido\(s\) entregado\(s\) por \$8\.000/),
  ).toBeVisible();
  await shot(page, "04-admin-lista");

  const href = await page
    .getByRole("link", { name: /Exportar los cierres/ })
    .getAttribute("href");
  const csv = await page.request.get(href!);
  expect(csv.status()).toBe(200);
  expect(csv.headers()["content-type"]).toMatch(/^text\/csv/);
  const bytes = await csv.body();
  expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  const text = bytes.toString("utf8");
  expect(text).toContain("Consecutivo;Cafetería;Fecha;Turno");
  expect(text.split("\r\n").filter(Boolean)).toHaveLength(3);

  const tolerance = page.getByLabel("Tolerancia de diferencia (COP)");
  await tolerance.fill("3000");
  await page.getByRole("button", { name: "Guardar tolerancia" }).click();
  await expect(page.getByText("Tolerancia guardada.").first()).toBeVisible();
  await page.reload();
  await expect(page.getByText(/Actual: \$3\.000/)).toBeVisible();
});

test("ADMIN reopens only the latest closure and only without another open drawer", async ({
  page,
}) => {
  await login(page, "admin@example.invalid", /\/admin$/);
  await page.goto("/admin/caja");
  const rows = page.locator("table tbody tr");
  await expect(rows).toHaveCount(2);
  const reason = "Faltó registrar un retiro del turno";
  const reopen = async () => {
    await page.getByLabel("Motivo de la reapertura").fill(reason);
    await page
      .getByRole("button", { name: "Reabrir caja", exact: true })
      .click();
    await page.getByRole("button", { name: "Sí, reabrir la caja" }).click();
  };
  // Newest first: row 2 is the first closure (breakfast), not the latest.
  await rows.nth(1).getByRole("button", { name: "Ver" }).click();
  await reopen();
  await expect(
    page.getByText(BACKEND_ERROR_MESSAGES.CASH_REOPEN_NOT_LATEST),
  ).toBeVisible();

  await page.reload();
  await rows.nth(0).getByRole("button", { name: "Ver" }).click();
  await reopen();
  await expect(page.getByText(/Reabierta/).first()).toBeVisible();

  // With that drawer open again, no other closure can be reopened.
  await page.reload();
  await rows.nth(1).getByRole("button", { name: "Ver" }).click();
  await reopen();
  await expect(
    page.getByText(BACKEND_ERROR_MESSAGES.CASH_SESSION_ALREADY_OPEN),
  ).toBeVisible();
});

test("an ADMIN operates only its own cafeteria", async ({ page }) => {
  await login(page, "admin@example.invalid", /\/admin$/);
  await page.goto("/admin/caja");
  await page
    .locator("table tbody tr")
    .first()
    .getByRole("button", { name: "Ver" })
    .click();
  await expect(page.getByText("Comprobante de cierre de caja")).toBeVisible();
  const listing = await (
    await page.request.get(`/api/cash/sessions?from=2000-01-01&to=2100-01-01`)
  ).json();
  const central = listing.sessions[0].id as string;

  await page.context().clearCookies();
  await login(page, "adminother@example.invalid", /\/admin$/);
  const other = await page.request.get(`/api/cash/sessions/${central}`);
  expect(other.status()).toBe(404);
  const own = await (
    await page.request.get(`/api/cash/sessions?from=2000-01-01&to=2100-01-01`)
  ).json();
  expect(own.sessions).toEqual([]);
});

test("SUPER_ADMIN reads every cafeteria and cannot operate", async ({
  page,
}) => {
  await login(page, "superadmin@example.invalid", /\/super-admin$/);
  await page.goto("/super-admin/caja");
  await expect(
    page.getByRole("heading", { name: "Cierres de caja" }),
  ).toBeVisible();
  await expect(page.locator("table tbody tr")).toHaveCount(2);
  await expect(
    page.getByRole("columnheader", { name: "Cafetería" }),
  ).toBeVisible();
  await page
    .locator("table tbody tr")
    .first()
    .getByRole("button", { name: "Ver" })
    .click();
  await expect(page.getByText("Comprobante de cierre de caja")).toBeVisible();
  // Read-only: no operation is offered.
  for (const name of [
    "Reabrir caja",
    "Guardar tolerancia",
    "Cerrar caja",
    "Registrar movimiento",
  ])
    await expect(page.getByRole("button", { name, exact: true })).toHaveCount(
      0,
    );
  await shot(page, "05-superadmin");
  // And the BFF refuses an operation even when called directly.
  const origin = new URL(page.url()).origin;
  const refused = await page.request.post("/api/cash/sessions", {
    headers: { origin, "content-type": "application/json" },
    data: { shift: "LUNCH", openingFloat: 0 },
  });
  expect(refused.status()).toBe(403);
  expect((await refused.json()).code).toBe("CASH_FORBIDDEN");
});

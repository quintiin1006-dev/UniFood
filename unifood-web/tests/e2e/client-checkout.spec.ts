import { test, expect, type Page, type Request } from "@playwright/test";
import { CAFETERIA_CENTRAL, PRODUCT } from "../fixtures/client-menu";

test.skip(
  !!process.env.PLAYWRIGHT_BASE_URL,
  "Requires the controlled local auth provider",
);
const storageKey = "unifood.client.cart.v2";
async function login(page: Page, email = "client@example.invalid") {
  const origin = new URL(test.info().project.use.baseURL as string).origin;
  const response = await page.request.post("/api/auth/login", {
    headers: { origin },
    data: { email, password: "UnaClave8", entrypoint: "client" },
  });
  expect(response.status()).toBe(200);
}
async function addChicken(page: Page) {
  await page.goto(
    `/cuenta/producto/${PRODUCT.chicken}?cafeteria=${CAFETERIA_CENTRAL}`,
  );
  await page
    .getByRole("button", { name: "Agregar al carrito", exact: true })
    .click();
  await page
    .getByRole("navigation", { name: "Navegación del estudiante" })
    .getByRole("link", { name: /^Carrito/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "Tu carrito", exact: true }),
  ).toBeVisible({ timeout: 30_000 });
}
async function openSummary(page: Page) {
  await addChicken(page);
  await page.getByRole("link", { name: "Continuar con el pedido" }).click();
  // The summary reads the menu through the BFF; the first visit compiles it in next dev.
  await expect(
    page.getByRole("heading", { name: "Resumen del pedido" }),
  ).toBeVisible({ timeout: 30_000 });
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(() => {
      const main = document.querySelector("main")!;
      return (
        document.documentElement.scrollWidth <= innerWidth &&
        main.scrollWidth <= main.clientWidth
      );
    }),
  ).toBe(true);
}
/** Every POST /api/me/orders the browser sends, with the headers and body that matter. */
function recordOrders(page: Page) {
  const sent: { key: string | undefined; body: Record<string, unknown> }[] = [];
  page.on("request", (request: Request) => {
    if (
      new URL(request.url()).pathname === "/api/me/orders" &&
      request.method() === "POST"
    )
      sent.push({
        key: request.headers()["idempotency-key"],
        body: request.postDataJSON(),
      });
  });
  return sent;
}
const confirmButton = (page: Page) =>
  page.getByRole("button", { name: /^(Confirmar pedido|Reintentar envío)$/ });
const accept = (page: Page) =>
  page.getByRole("checkbox", { name: /He revisado mi pedido/ }).check();
const alertBox = (page: Page) => page.getByRole("main").getByRole("alert");
/** HH:mm in Bogotá, minutes ahead of the real clock. */
function bogotaTime(minutesAhead: number) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Bogota",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(Date.now() + minutesAhead * 60_000));
  return parts;
}

for (const width of [320, 375, 390, 412, 430, 1280]) {
  test(`cart and checkout fit ${width}px; confirming sends the order and empties the cart`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const sent = recordOrders(page);
    await login(page);
    await addChicken(page);
    await page
      .getByRole("button", {
        name: "Aumentar cantidad de Pechuga a la plancha",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("status", { name: "Cantidad de Pechuga a la plancha" }),
    ).toHaveText("2");
    await noOverflow(page);
    await page.getByRole("link", { name: "Continuar con el pedido" }).click();
    await expect(
      page.getByRole("heading", { name: "Resumen del pedido" }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      page
        .getByRole("navigation", { name: "Navegación del estudiante" })
        .getByRole("link", { name: /^Carrito/ }),
    ).toHaveAttribute("aria-current", "page");
    // No hours, slots or preview: the default is "lo antes posible".
    await expect(page.getByText(/Probar sin horario/)).toHaveCount(0);
    await expect(page.getByRole("combobox")).toHaveCount(0);
    await expect(page.getByLabel("Lo antes posible")).toBeChecked();
    await expect(page.locator("#pickup-time")).toHaveCount(0);
    const confirm = confirmButton(page);
    await expect(confirm).toBeDisabled();
    await accept(page);
    await expect(confirm).toBeEnabled();
    await noOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath(`checkout-${width}.png`),
    });
    await confirm.click();
    await expect(
      page.getByRole("heading", { name: "Pedido enviado" }),
    ).toBeFocused({ timeout: 30_000 });
    await expect(page.getByText("Lo antes posible")).toBeVisible();
    await expect(page.getByText(/30\.000/).last()).toBeVisible();
    await expect(page.getByText(/Pechuga a la plancha/)).toBeVisible();
    await noOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath(`confirmation-${width}.png`),
    });
    // The BFF got the ids only, with a key; the cart is gone and cannot be sent twice.
    expect(sent).toHaveLength(1);
    expect(sent[0].key).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
    expect(sent[0].body).toEqual({
      cafeteriaId: CAFETERIA_CENTRAL,
      items: [{ productId: PRODUCT.chicken, quantity: 2 }],
    });
    await expect(
      page
        .getByRole("navigation", { name: "Navegación del estudiante" })
        .getByRole("link", { name: /^Carrito/ }),
    ).toHaveAccessibleName("Carrito");
    await page.getByRole("link", { name: "Volver al inicio" }).click();
    await expect(page).toHaveURL(/\/cuenta/);
    await page.goto("/cuenta/carrito/resumen");
    await expect(
      page.getByRole("heading", { name: "Tu carrito está vacío" }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test("a note and a chosen pickup time travel with the order and appear in the confirmation", async ({
  page,
}) => {
  test.skip(
    Number(bogotaTime(0).slice(0, 2)) * 60 + Number(bogotaTime(0).slice(3)) >
      23 * 60 + 30,
    "Too close to midnight in Bogotá to pick a time for today",
  );
  const sent = recordOrders(page);
  await login(page);
  await openSummary(page);
  await page.getByLabel("Elegir hora").check();
  const time = page.locator("#pickup-time");
  await expect(time).toHaveAttribute("min", /^\d\d:\d\d$/);
  // Past times are refused in the browser and nothing is sent.
  await time.fill("00:00");
  await accept(page);
  await confirmButton(page).click();
  await expect(alertBox(page)).toContainText("posterior a la actual");
  expect(sent).toHaveLength(0);
  const later = bogotaTime(15);
  await time.fill(later);
  await page.getByLabel(/Nota para el pedido/).fill("Sin cebolla, por favor");
  await confirmButton(page).click();
  await expect(
    page.getByRole("heading", { name: "Pedido enviado" }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Sin cebolla, por favor")).toBeVisible();
  await expect(page.getByText(/Colombia/).first()).toBeVisible();
  expect(sent).toHaveLength(1);
  expect(sent[0].body.note).toBe("Sin cebolla, por favor");
  // ISO-8601 with the Bogotá offset, for today.
  expect(sent[0].body.requestedPickupAt).toMatch(
    new RegExp(`^\\d{4}-\\d\\d-\\d\\dT${later}:00-05:00$`),
  );
});

test("the note is limited to 200 characters in the browser", async ({
  page,
}) => {
  const sent = recordOrders(page);
  await login(page);
  await openSummary(page);
  const note = page.getByLabel(/Nota para el pedido/);
  await note.fill("a".repeat(201));
  await expect(page.getByText("201/200 caracteres")).toBeVisible();
  await accept(page);
  await confirmButton(page).click();
  await expect(alertBox(page)).toContainText("hasta 200 caracteres");
  expect(sent).toHaveLength(0);
  await note.fill("a".repeat(200));
  await confirmButton(page).click();
  await expect(
    page.getByRole("heading", { name: "Pedido enviado" }),
  ).toBeVisible({ timeout: 30_000 });
});

test("each rejection shows a fixed Spanish message with its next step and keeps the cart", async ({
  page,
}) => {
  const sent = recordOrders(page);
  await login(page);
  await openSummary(page);
  const cases: [string, RegExp, string | null][] = [
    ["CAFETERIA_CLOSED", /La cafetería está cerrada/, "Ir al menú"],
    ["PRODUCT_UNAVAILABLE", /ya no está disponible/, "Revisar carrito"],
    ["ACTIVE_ORDER_EXISTS", /pedido en curso/, "Ir al inicio"],
    ["INVALID_PICKUP_TIME", /hora de recogida ya no es válida/, null],
    ["IDEMPOTENCY_KEY_CONFLICT", /Tu pedido cambió/, null],
    [
      "ORDER_LIMIT_EXCEEDED",
      /10 unidades por producto y 15/,
      "Revisar carrito",
    ],
    ["INVALID_ORDER_REQUEST", /No pudimos validar/, "Revisar carrito"],
    ["CAFETERIA_NOT_SUBSCRIBED", /Elige otra/, "Elegir cafetería"],
    ["CAFETERIA_NOT_FOUND", /Elige otra/, "Elegir cafetería"],
    ["FORBIDDEN", /no puede crear pedidos/, "Ir al inicio"],
    ["ORDER_TEMPORARILY_UNAVAILABLE", /carrito se conserva/, null],
  ];
  const note = page.getByLabel(/Nota para el pedido/);
  await accept(page);
  for (const [code, message, action] of cases) {
    await note.fill(`__error:${code}`);
    await confirmButton(page).click();
    await expect(alertBox(page)).toContainText(message, { timeout: 30_000 });
    await expect(alertBox(page)).not.toContainText(
      /PRIVATE|Spring|activeOrder/,
    );
    if (action)
      await expect(
        alertBox(page).getByRole("link", { name: action }),
      ).toBeVisible();
    // Nothing was created and the cart is untouched.
    await expect(
      page.getByRole("heading", { name: "Pedido enviado" }),
    ).toHaveCount(0);
    expect(
      await page.evaluate((key) => localStorage.getItem(key), storageKey),
    ).toContain(PRODUCT.chicken);
  }
  expect(sent).toHaveLength(cases.length);
});

test("a retry after a temporary failure reuses the Idempotency-Key; changing the order uses a new one", async ({
  page,
}) => {
  const sent = recordOrders(page);
  await login(page);
  await openSummary(page);
  const note = page.getByLabel(/Nota para el pedido/);
  await accept(page);
  await note.fill("__fail-once");
  await confirmButton(page).click();
  await expect(alertBox(page)).toContainText("Revisa tu conexión", {
    timeout: 30_000,
  });
  await expect(
    page.getByRole("button", { name: "Reintentar envío" }),
  ).toBeVisible();
  // The cart is intact, and the same content goes out with the same key.
  await page.getByRole("button", { name: "Reintentar envío" }).click();
  await expect(
    page.getByRole("heading", { name: "Pedido enviado" }),
  ).toBeVisible({ timeout: 30_000 });
  expect(sent).toHaveLength(2);
  expect(sent[1].key).toBe(sent[0].key);
  expect(sent[1].body).toEqual(sent[0].body);
});

test("a response lost after the order was created is recovered with the same key", async ({
  page,
}) => {
  const sent = recordOrders(page);
  await login(page);
  await openSummary(page);
  await accept(page);
  await page.getByLabel(/Nota para el pedido/).fill("__lose-response");
  await confirmButton(page).click();
  await expect(alertBox(page)).toContainText("Revisa tu conexión", {
    timeout: 30_000,
  });
  await page.getByRole("button", { name: "Reintentar envío" }).click();
  // The backend answers 200 for the repeated key: the same order, counted as a success.
  await expect(
    page.getByRole("heading", { name: "Pedido enviado" }),
  ).toBeVisible({ timeout: 30_000 });
  expect(sent).toHaveLength(2);
  expect(sent[1].key).toBe(sent[0].key);
  await expect(
    page
      .getByRole("navigation", { name: "Navegación del estudiante" })
      .getByRole("link", { name: /^Carrito/ }),
  ).toHaveAccessibleName("Carrito");
});

test("editing the note after a failure starts a new attempt with a new key", async ({
  page,
}) => {
  const sent = recordOrders(page);
  await login(page);
  await openSummary(page);
  await accept(page);
  const note = page.getByLabel(/Nota para el pedido/);
  await note.fill("__fail-once");
  await confirmButton(page).click();
  await expect(alertBox(page)).toBeVisible({ timeout: 30_000 });
  await note.fill("Con servilletas");
  await confirmButton(page).click();
  await expect(
    page.getByRole("heading", { name: "Pedido enviado" }),
  ).toBeVisible({ timeout: 30_000 });
  expect(sent).toHaveLength(2);
  expect(sent[1].key).not.toBe(sent[0].key);
});

test("a double click sends the order once", async ({ page }) => {
  const sent = recordOrders(page);
  await login(page);
  await openSummary(page);
  await accept(page);
  await confirmButton(page).dblclick();
  await expect(
    page.getByRole("heading", { name: "Pedido enviado" }),
  ).toBeVisible({ timeout: 30_000 });
  expect(sent).toHaveLength(1);
});

test("checkout revalidates persisted changes before confirming and cannot confirm an empty cart", async ({
  page,
}) => {
  const sent = recordOrders(page);
  await login(page);
  await openSummary(page);
  await accept(page);
  // A same-tab storage write deliberately skips the storage event: submit must reread it.
  await page.evaluate((key) => {
    const saved = JSON.parse(localStorage.getItem(key)!);
    saved.cart.lines[0].quantity = 3;
    localStorage.setItem(key, JSON.stringify(saved));
  }, storageKey);
  await confirmButton(page).click();
  await expect(page.getByText(/El carrito cambió/)).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: /He revisado mi pedido/ }),
  ).not.toBeChecked();
  await expect(
    page.getByRole("list", { name: "Productos del pedido" }),
  ).toContainText("3 × Pechuga");
  await accept(page);
  await page.evaluate((key) => localStorage.removeItem(key), storageKey);
  await confirmButton(page).click();
  await expect(
    page.getByRole("heading", { name: "Tu carrito está vacío" }),
  ).toBeVisible();
  expect(sent).toHaveLength(0);
});

test("cart editing respects the 10-unit limit and swiping reveals an explicit delete action", async ({
  page,
}) => {
  await login(page);
  await addChicken(page);
  const increase = page.getByRole("button", {
    name: "Aumentar cantidad de Pechuga a la plancha",
  });
  for (let count = 1; count < 10; count++) await increase.click();
  await expect(increase).toBeDisabled();
  await page
    .getByRole("button", { name: "Reducir cantidad de Pechuga a la plancha" })
    .click();
  await expect(increase).toBeEnabled();
  const item = page.locator("li").filter({
    has: page.getByRole("heading", { name: "Pechuga a la plancha" }),
  });
  await item.dispatchEvent("pointerdown", {
    clientX: 270,
    clientY: 320,
    pointerType: "touch",
  });
  await item.dispatchEvent("pointerup", {
    clientX: 120,
    clientY: 324,
    pointerType: "touch",
  });
  await page.getByRole("button", { name: "Confirmar eliminación" }).click();
  await expect(
    page.getByRole("heading", { name: "Tu carrito está vacío" }),
  ).toBeVisible();
  await page.goto("/cuenta/carrito/resumen");
  await expect(
    page.getByRole("heading", { name: "Tu carrito está vacío" }),
  ).toBeVisible();
});

import { test, expect, type Page } from "@playwright/test";

test.skip(
  !!process.env.PLAYWRIGHT_BASE_URL,
  "Requires the controlled local auth provider",
);
const lunch = new Date("2026-10-07T12:00:00-05:00");
const pickup = "2026-10-07T17:30:00.000Z";
const storageKey = "unifood.client.cart.v1";
async function login(page: Page, email = "client@example.invalid") {
  const origin = new URL(test.info().project.use.baseURL as string).origin;
  const response = await page.request.post("/api/auth/login", {
    headers: { origin },
    data: { email, password: "UnaClave8", entrypoint: "client" },
  });
  expect(response.status()).toBe(200);
}
async function addChicken(page: Page) {
  await page.goto("/cuenta/producto/chicken?sede=principal");
  await page
    .getByRole("button", { name: "Agregar al carrito", exact: true })
    .click();
  await page
    .getByRole("navigation", { name: "Navegación del estudiante" })
    .getByRole("link", { name: /^Carrito/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "Tu carrito", exact: true }),
  ).toBeVisible();
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

for (const width of [320, 375, 390, 412, 430, 1280]) {
  test(`editable cart and checkout fit ${width}px and preserve the cart after preview confirmation`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await page.clock.setFixedTime(lunch);
    const errors: string[] = [];
    const operationalRequests: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      if (/\/api\/(orders|me\/orders)/.test(request.url()))
        operationalRequests.push(request.url());
    });
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
    await page
      .getByRole("button", {
        name: "Editar observaciones de Pechuga a la plancha",
      })
      .click();
    const dialog = page.getByRole("dialog", { name: "Editar observaciones" });
    await expect(
      dialog.getByRole("textbox", { name: /Observaciones/ }),
    ).toBeFocused();
    await dialog
      .getByRole("textbox", { name: /Observaciones/ })
      .fill("Sin cubiertos, por favor");
    await page.setViewportSize({ width, height: 460 });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Guardar observaciones" }).click();
    await expect(dialog).toHaveCount(0);
    await page.setViewportSize({ width, height: 844 });
    await expect(
      page.getByText("Sin cubiertos, por favor", { exact: true }),
    ).toBeVisible();
    await noOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath(`editable-cart-${width}.png`),
    });
    await page.getByRole("link", { name: "Continuar con el pedido" }).click();
    await expect(
      page.getByRole("heading", { name: "Resumen del pedido" }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("navigation", { name: "Navegación del estudiante" })
        .getByRole("link", { name: /^Carrito/ }),
    ).toHaveAttribute("aria-current", "page");
    const confirm = page.getByRole("button", {
      name: "Confirmar pedido",
      exact: true,
    });
    await expect(confirm).toBeDisabled();
    await page
      .getByRole("combobox", { name: /Elige tu hora/ })
      .selectOption(pickup);
    await expect(confirm).toBeDisabled();
    await page.getByRole("checkbox", { name: /He revisado mi pedido/ }).check();
    await expect(confirm).toBeEnabled();
    await noOverflow(page);
    await page.getByRole("main").evaluate((element) => {
      element.scrollTop = 0;
    });
    await page.screenshot({
      path: testInfo.outputPath(`checkout-${width}.png`),
    });
    await confirm.click();
    await expect(
      page.getByRole("heading", { name: "Resumen confirmado" }),
    ).toBeFocused();
    await expect(
      page.getByText(/todavía no se ha enviado un pedido/),
    ).toBeVisible();
    await expect(page.getByText(/30\.000/).last()).toBeVisible();
    await noOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath(`confirmation-${width}.png`),
    });
    await page
      .getByRole("link", { name: "Volver al carrito", exact: true })
      .click();
    await expect(page).toHaveURL(/\/cuenta\/carrito$/);
    await expect(
      page.getByRole("heading", { name: "Tu carrito", exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("status", { name: "Cantidad de Pechuga a la plancha" }),
    ).toHaveText("2");
    expect(errors).toEqual([]);
    expect(operationalRequests).toEqual([]);
  });
}

test("checkout expires a selected pickup, rejects forged submission and shows the next estimate", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-10-07T12:09:00-05:00") });
  await login(page);
  await addChicken(page);
  await page.getByRole("link", { name: "Continuar con el pedido" }).click();
  await page
    .getByRole("combobox", { name: /Elige tu hora/ })
    .selectOption(pickup);
  await page.getByRole("checkbox", { name: /He revisado mi pedido/ }).check();
  const confirm = page.getByRole("button", {
    name: "Confirmar pedido",
    exact: true,
  });
  await expect(confirm).toBeEnabled();
  await page.clock.setSystemTime(new Date("2026-10-07T12:11:00-05:00"));
  await page.clock.runFor(61_000);
  await expect(confirm).toBeDisabled();
  await expect(page.getByText(/La hora elegida ya no permite/)).toContainText(
    /1:00/,
  );
  await page.locator("form").dispatchEvent("submit");
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "al menos 20 minutos",
  );
  await expect(
    page.getByRole("heading", { name: "Resumen confirmado" }),
  ).toHaveCount(0);
  await page.clock.setSystemTime(new Date("2026-10-07T14:11:00-05:00"));
  await page.clock.runFor(61_000);
  await expect(page.getByRole("combobox")).toBeDisabled();
  await expect(page.getByText(/Ya no quedan horarios/)).toBeVisible();
});

test("after-hours preview supports checkout with a twenty-minute margin and respects disabling preview", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-10-07T22:00:00-05:00"));
  await login(page);
  await page.goto("/cuenta/producto/chicken?sede=principal");
  const preview = page.getByRole("checkbox", { name: /^Probar sin horario/ });
  await preview.check();
  await addChicken(page);
  await page.getByRole("link", { name: "Continuar con el pedido" }).click();
  await page.getByRole("combobox").selectOption("2026-10-08T16:30:00.000Z");
  await page.getByRole("checkbox", { name: /He revisado mi pedido/ }).check();
  await expect(
    page.getByRole("button", { name: "Confirmar pedido" }),
  ).toBeEnabled();
  await preview.uncheck();
  await expect(
    page.getByRole("checkbox", { name: /He revisado mi pedido/ }),
  ).not.toBeChecked();
  await expect(
    page.getByRole("button", { name: "Confirmar pedido" }),
  ).toBeDisabled();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Disponible de",
  );
});

test("checkout revalidates persisted changes before confirming and cannot confirm an empty cart", async ({
  page,
}) => {
  await page.clock.setFixedTime(lunch);
  await login(page);
  await addChicken(page);
  await page.getByRole("link", { name: "Continuar con el pedido" }).click();
  await page.getByRole("combobox").selectOption(pickup);
  await page.getByRole("checkbox", { name: /He revisado mi pedido/ }).check();
  // A same-tab storage write deliberately skips the storage event: submit must reread it.
  await page.evaluate((key) => {
    const saved = JSON.parse(localStorage.getItem(key)!);
    saved.cart.lines[0].quantity = 3;
    localStorage.setItem(key, JSON.stringify(saved));
  }, storageKey);
  await page.getByRole("button", { name: "Confirmar pedido" }).click();
  await expect(page.getByText(/El carrito cambió/)).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: /He revisado mi pedido/ }),
  ).not.toBeChecked();
  await expect(
    page.getByRole("list", { name: "Platos del pedido" }),
  ).toContainText("3 × Pechuga");
  await page.getByRole("combobox").selectOption(pickup);
  await page.getByRole("checkbox", { name: /He revisado mi pedido/ }).check();
  await page.evaluate((key) => localStorage.removeItem(key), storageKey);
  await page.getByRole("button", { name: "Confirmar pedido" }).click();
  await expect(
    page.getByRole("heading", { name: "Tu carrito está vacío" }),
  ).toBeVisible();
});

test("cart editing respects limits, notes can be cancelled and swiping reveals an explicit delete action", async ({
  page,
}) => {
  await page.clock.setFixedTime(lunch);
  await login(page);
  await addChicken(page);
  const increase = page.getByRole("button", {
    name: "Aumentar cantidad de Pechuga a la plancha",
  });
  await increase.click();
  await increase.click();
  await expect(increase).toBeDisabled();
  await page
    .getByRole("button", { name: "Reducir cantidad de Pechuga a la plancha" })
    .click();
  await expect(increase).toBeEnabled();
  const edit = page.getByRole("button", {
    name: "Editar observaciones de Pechuga a la plancha",
  });
  await edit.click();
  await page
    .getByRole("dialog")
    .getByRole("textbox")
    .fill("Borrador sin guardar");
  await page.keyboard.press("Escape");
  await expect(edit).toBeFocused();
  await expect(page.getByText("Borrador sin guardar")).toHaveCount(0);
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

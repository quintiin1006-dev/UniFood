import { test, expect, type Page } from "@playwright/test";

test.skip(
  !!process.env.PLAYWRIGHT_BASE_URL,
  "Requires the controlled local auth provider",
);
const earlyMorning = new Date("2026-10-08T02:00:00-05:00");
const cartKey = "unifood.client.cart.v1";
async function startPreview(page: Page) {
  await page.clock.setFixedTime(earlyMorning);
  const origin = new URL(test.info().project.use.baseURL as string).origin;
  const response = await page.request.post("/api/auth/login", {
    headers: { origin },
    data: {
      email: "client@example.invalid",
      password: "UnaClave8",
      entrypoint: "client",
    },
  });
  expect(response.status()).toBe(200);
  await page.goto("/cuenta/producto/breakfast-eggs?sede=principal");
  await page.getByRole("checkbox", { name: /^Probar sin horario/ }).check();
}
const cartLink = (page: Page) =>
  page
    .getByRole("navigation", { name: "Navegación del estudiante" })
    .getByRole("link", { name: /^Carrito/ });
async function expectSlotValues(page: Page, values: string[]) {
  await expect
    .poll(async () =>
      page
        .getByRole("combobox")
        .locator("option")
        .evaluateAll((options) =>
          options
            .map((option) => (option as HTMLOptionElement).value)
            .filter(Boolean),
        ),
    )
    .toEqual(values);
}

test("product quantity can be increased before adding and updated afterwards without duplication", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await startPreview(page);
  const quantity = page.getByRole("status", { name: "Cantidad seleccionada" });
  const plus = page.getByRole("button", {
    name: "Aumentar cantidad",
    exact: true,
  });
  const minus = page.getByRole("button", {
    name: "Reducir cantidad",
    exact: true,
  });
  await plus.tap();
  await expect(quantity).toHaveText("2");
  await expect(page.getByText(/\$\s*20\.000/)).toBeVisible();
  await page
    .getByRole("textbox", { name: /Observaciones/ })
    .fill("Sin cubiertos");
  await page
    .getByRole("button", { name: "Agregar al carrito", exact: true })
    .tap();
  await expect(cartLink(page)).toHaveAccessibleName("Carrito, 2 platos");
  await expect(quantity).toHaveText("2");
  await plus.tap();
  await expect(quantity).toHaveText("3");
  await expect(plus).toBeDisabled();
  await page
    .getByRole("button", { name: "Actualizar carrito", exact: true })
    .tap();
  await expect(cartLink(page)).toHaveAccessibleName("Carrito, 3 platos");
  await minus.tap();
  await page
    .getByRole("button", { name: "Actualizar carrito", exact: true })
    .tap();
  await expect(cartLink(page)).toHaveAccessibleName("Carrito, 2 platos");
  await page.reload();
  await expect(quantity).toHaveText("2");
  await expect(
    page.getByRole("textbox", { name: /Observaciones/ }),
  ).toHaveValue("Sin cubiertos");
  const stored = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!).cart,
    cartKey,
  );
  expect(stored.lines).toHaveLength(1);
  expect(stored.lines[0].quantity).toBe(2);
  await page.goto("/cuenta/producto/breakfast-broth?sede=principal");
  await expect(plus).toBeDisabled();
  await page
    .getByRole("button", { name: "Agregar al carrito", exact: true })
    .tap();
  await expect(cartLink(page)).toHaveAccessibleName("Carrito, 3 platos");
  await page.goto("/cuenta/producto/breakfast-eggs?sede=principal");
  await expect(quantity).toHaveText("2");
  await expect(plus).toBeDisabled();
});

test("at 2 am breakfast offers only 6–8:30 and lunch only 11:30–14:30 Colombian time", async ({
  page,
}) => {
  await startPreview(page);
  await page
    .getByRole("button", { name: "Agregar al carrito", exact: true })
    .click();
  await page.goto("/cuenta/carrito/resumen");
  const breakfastValues = [
    "11:00",
    "11:30",
    "12:00",
    "12:30",
    "13:00",
    "13:30",
  ].map((clock) => `2026-10-08T${clock}:00.000Z`);
  await expectSlotValues(page, breakfastValues);
  await page.getByRole("combobox").selectOption(breakfastValues[0]);
  await page.getByRole("checkbox", { name: /He revisado mi pedido/ }).check();
  await expect(
    page.getByRole("button", { name: "Confirmar pedido" }),
  ).toBeEnabled();
  await page.clock.setFixedTime(new Date("2026-10-08T22:00:00-05:00"));
  await page.reload();
  await expectSlotValues(
    page,
    breakfastValues.map((value) => value.replace("2026-10-08", "2026-10-09")),
  );
  await page.goto("/cuenta/carrito");
  await page
    .getByRole("button", { name: "Vaciar carrito", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Vaciar carrito", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Tu carrito está vacío" }),
  ).toBeVisible();
  await page.clock.setFixedTime(earlyMorning);
  await page.goto("/cuenta/producto/chicken?sede=principal");
  await page
    .getByRole("button", { name: "Agregar al carrito", exact: true })
    .click();
  await page.goto("/cuenta/carrito/resumen");
  await expectSlotValues(
    page,
    ["16:30", "17:00", "17:30", "18:00", "18:30", "19:00", "19:30"].map(
      (clock) => `2026-10-08T${clock}:00.000Z`,
    ),
  );
});

test("new mixed orders are blocked and older mixed carts can be repaired without losing their contents", async ({
  page,
}) => {
  await startPreview(page);
  await page
    .getByRole("button", { name: "Agregar al carrito", exact: true })
    .click();
  await page.goto("/cuenta/producto/chicken?sede=principal");
  await expect(
    page.getByRole("button", { name: "Agregar al carrito", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("status", { name: "Disponibilidad del plato" }),
  ).toContainText("por separado");
  await page.locator("form").dispatchEvent("submit");
  await expect(cartLink(page)).toHaveAccessibleName("Carrito, 1 plato");
  await page.evaluate((key) => {
    const saved = JSON.parse(localStorage.getItem(key)!);
    saved.cart.lines.push({
      id: "legacy-lunch",
      mealId: "chicken",
      quantity: 1,
      notes: "",
    });
    localStorage.setItem(key, JSON.stringify(saved));
  }, cartKey);
  await page.goto("/cuenta/carrito/resumen");
  await page.reload();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "por separado",
  );
  await expect(page.getByRole("combobox")).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Confirmar pedido" }),
  ).toBeDisabled();
  await page.goto("/cuenta/carrito");
  await expect(cartLink(page)).toHaveAccessibleName("Carrito, 2 platos");
  await expect(page.getByText(/deben pedirse por separado/)).toBeVisible();
  await page
    .getByRole("button", { name: "Eliminar Pechuga a la plancha", exact: true })
    .click();
  await expect(cartLink(page)).toHaveAccessibleName("Carrito, 1 plato");
  await page.getByRole("link", { name: "Continuar con el pedido" }).click();
  await expectSlotValues(
    page,
    ["11:00", "11:30", "12:00", "12:30", "13:00", "13:30"].map(
      (clock) => `2026-10-08T${clock}:00.000Z`,
    ),
  );
});

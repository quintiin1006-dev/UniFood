import { test, expect, type Page } from "@playwright/test";
import {
  CAFETERIA_BLOQUE_B,
  CAFETERIA_CENTRAL,
  PRODUCT,
} from "../fixtures/client-menu";

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
const cartNav = (page: Page) =>
  page
    .getByRole("navigation", { name: "Navegación del estudiante" })
    .getByRole("link", { name: /^Carrito/ });
const productPath = (productId: string, cafeteriaId = CAFETERIA_CENTRAL) =>
  `/cuenta/producto/${productId}?cafeteria=${cafeteriaId}`;
const addButton = (page: Page) =>
  page.getByRole("button", { name: "Agregar al carrito", exact: true });
const increase = (page: Page) =>
  page.getByRole("button", { name: "Aumentar cantidad" });

async function addProduct(page: Page, productId: string, quantity = 1) {
  await page.goto(productPath(productId));
  for (let count = 1; count < quantity; count++) await increase(page).click();
  await expect(page.getByLabel("Cantidad seleccionada")).toHaveText(
    String(quantity),
  );
  await addButton(page).click();
}

test("§6 limits: 10 units per product and 15 per order, without stock", async ({
  page,
}) => {
  await login(page);
  await page.goto(productPath(PRODUCT.juice));
  await expect(
    page.getByText("Máximo 10 por producto y 15 por pedido."),
  ).toBeVisible();
  for (let count = 1; count < 10; count++) await increase(page).click();
  await expect(page.getByLabel("Cantidad seleccionada")).toHaveText("10");
  await expect(increase(page)).toBeDisabled();
  await expect(page.getByText(/\$\s*45\.000/)).toBeVisible();
  await addButton(page).click();
  await expect(cartNav(page)).toHaveAccessibleName("Carrito, 10 unidades");
  await page.reload();
  await expect(cartNav(page)).toHaveAccessibleName("Carrito, 10 unidades");
  await expect(
    page.getByRole("button", { name: "Actualizar carrito", exact: true }),
  ).toBeDisabled();

  await page.goto(productPath(PRODUCT.lemonade));
  for (let count = 1; count < 5; count++) await increase(page).click();
  await expect(increase(page)).toBeDisabled();
  await addButton(page).click();
  await expect(cartNav(page)).toHaveAccessibleName("Carrito, 15 unidades");

  await page.goto(productPath(PRODUCT.daily));
  await expect(
    page.getByText("Tu carrito ya tiene 15 unidades, el máximo por pedido."),
  ).toBeVisible();
  await expect(addButton(page)).toBeDisabled();

  await cartNav(page).click();
  await expect(page.getByText("15 de 15 unidades")).toBeVisible();
  await expect(page.getByText(/\$\s*75\.000/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Aumentar cantidad de Jugo natural" }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Reducir cantidad de Jugo natural" })
    .click();
  await expect(cartNav(page)).toHaveAccessibleName("Carrito, 14 unidades");
  await expect(
    page.getByRole("button", { name: "Aumentar cantidad de Limonada de coco" }),
  ).toBeEnabled();
});

test("breakfast, lunch and drinks share one cart and one line per product", async ({
  page,
}) => {
  await login(page);
  await addProduct(page, PRODUCT.pericos, 2);
  await addProduct(page, PRODUCT.chicken);
  await addProduct(page, PRODUCT.juice, 3);
  await expect(cartNav(page)).toHaveAccessibleName("Carrito, 6 unidades");
  await page.goto(productPath(PRODUCT.pericos));
  await expect(
    page.getByText(
      "Ya tienes 2 en el carrito. Ajusta la cantidad y guarda los cambios.",
    ),
  ).toBeVisible();
  await increase(page).click();
  await page
    .getByRole("button", { name: "Actualizar carrito", exact: true })
    .click();
  await expect(cartNav(page)).toHaveAccessibleName("Carrito, 7 unidades");
  await cartNav(page).click();
  await expect(page.getByRole("listitem").getByRole("heading")).toHaveText([
    "Huevos pericos con arepa",
    "Pechuga a la plancha",
    "Jugo natural",
  ]);
  await expect(
    page.getByRole("link", { name: "Continuar con el pedido" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Observaciones/ })).toHaveCount(
    0,
  );
  const stored = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!),
    storageKey,
  );
  expect(stored.cart).toEqual({
    cafeteriaId: CAFETERIA_CENTRAL,
    lines: [
      { productId: PRODUCT.pericos, quantity: 3 },
      { productId: PRODUCT.chicken, quantity: 1 },
      { productId: PRODUCT.juice, quantity: 3 },
    ],
  });
});

test("storage denial leaves a usable cart", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Storage.prototype, "setItem", {
      value: () => {
        throw new DOMException("Storage denied", "SecurityError");
      },
    });
  });
  await login(page);
  await page.goto(productPath(PRODUCT.chicken));
  await addButton(page).click();
  await expect(
    page.getByText(/no se pudo guardar para la próxima recarga/),
  ).toBeVisible();
  await cartNav(page).click();
  await expect(
    page.getByRole("heading", { name: "Tu carrito", exact: true }),
  ).toBeVisible();
  await expect(cartNav(page)).toHaveAccessibleName("Carrito, 1 unidad");
});

test("cart updates and logout clearing synchronize between tabs", async ({
  page,
  context,
}) => {
  await login(page);
  await page.goto(productPath(PRODUCT.chicken));
  const otherTab = await context.newPage();
  await otherTab.goto("/cuenta/carrito");
  await expect(
    otherTab.getByRole("heading", { name: "Tu carrito está vacío" }),
  ).toBeVisible();
  await addButton(page).click();
  await expect(cartNav(otherTab)).toHaveAccessibleName("Carrito, 1 unidad");
  await page.goto("/cuenta/perfil");
  const logoutResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/auth/logout" &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Cerrar sesión", exact: true })
    .click();
  expect((await logoutResponse).status()).toBe(200);
  await expect(page).toHaveURL(/\/login$/);
  await expect(
    otherTab.getByRole("heading", { name: "Tu carrito está vacío" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => [
      localStorage.getItem("unifood.client.cart.v2"),
      localStorage.getItem("unifood.client.cafeteria.v1"),
    ]),
  ).toEqual([null, null]);
  await otherTab.close();
});

test("changing cafeteria and emptying require confirmation and restore focus on cancel", async ({
  page,
}) => {
  await login(page);
  await page.goto(productPath(PRODUCT.chicken));
  await addButton(page).click();
  await expect(cartNav(page)).toHaveAccessibleName("Carrito, 1 unidad");
  await page.getByRole("link", { name: /^Cambiar cafetería/ }).click();
  await page.getByRole("link", { name: /^Sede Principal/ }).click();
  const other = page.getByRole("link", { name: /^Cafetería Bloque B/ });
  await other.click();
  const dialog = page.getByRole("dialog", { name: "¿Cambiar de cafetería?" });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(other).toBeFocused();
  await expect(cartNav(page)).toHaveAccessibleName("Carrito, 1 unidad");
  await page.goto(productPath(PRODUCT.closedChicken, CAFETERIA_BLOQUE_B));
  await expect(
    page.getByText(
      "Tu carrito tiene productos de otra cafetería. Vacíalo antes de cambiar.",
    ),
  ).toBeVisible();
  await expect(addButton(page)).toBeDisabled();
  await page.goto("/cuenta?elegir=1");
  await page.getByRole("link", { name: /^Sede Principal/ }).click();
  await page.getByRole("link", { name: /^Cafetería Bloque B/ }).click();
  await page.getByRole("button", { name: "Vaciar y cambiar" }).click();
  await expect(page).toHaveURL(`/cuenta?cafeteria=${CAFETERIA_BLOQUE_B}`);
  await expect(cartNav(page)).toHaveAccessibleName("Carrito");

  await page.goto(productPath(PRODUCT.juice));
  await addButton(page).click();
  await cartNav(page).click();
  await page
    .getByRole("button", { name: "Vaciar carrito", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "¿Vaciar tu carrito?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Conservar carrito" }).click();
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
});

test("legacy, foreign and corrupt stored carts are not admitted", async ({
  page,
}) => {
  await login(page);
  await page.goto("/cuenta/carrito");
  await page.evaluate(
    ([key]) => {
      localStorage.setItem(
        "unifood.client.cart.v1",
        JSON.stringify({
          ownerId: "any",
          cart: {
            siteId: "principal",
            lines: [{ id: "l", mealId: "chicken", quantity: 1, notes: "" }],
          },
        }),
      );
      localStorage.setItem(
        key,
        JSON.stringify({
          ownerId: "another-user",
          cart: {
            cafeteriaId: "00000000-0000-4000-8000-000000000201",
            lines: [
              {
                productId: "00000000-0000-4000-8000-000000000304",
                quantity: 1,
              },
            ],
          },
        }),
      );
    },
    [storageKey],
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Tu carrito está vacío" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => localStorage.getItem("unifood.client.cart.v1")),
  ).toBeNull();
  await page.evaluate(
    (key) => localStorage.setItem(key, "not valid json"),
    storageKey,
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Tu carrito está vacío" }),
  ).toBeVisible();
});

test("a product that left the menu stays removable and blocks continuing", async ({
  page,
}) => {
  await login(page);
  await page.goto(productPath(PRODUCT.juice));
  await addButton(page).click();
  await page.evaluate((key) => {
    const saved = JSON.parse(localStorage.getItem(key)!);
    saved.cart.lines.push({
      productId: "00000000-0000-4000-8000-000000000999",
      quantity: 1,
    });
    localStorage.setItem(key, JSON.stringify(saved));
  }, storageKey);
  await page.goto("/cuenta/carrito");
  await expect(
    page.getByRole("heading", { name: "Producto que ya no está en el menú" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Un producto de tu carrito ya no está en el menú. Retíralo para continuar.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Continuar con el pedido" }),
  ).toBeDisabled();
  await page
    .getByRole("button", {
      name: "Eliminar Producto que ya no está en el menú",
    })
    .click();
  await expect(
    page.getByRole("link", { name: "Continuar con el pedido" }),
  ).toBeVisible();
});

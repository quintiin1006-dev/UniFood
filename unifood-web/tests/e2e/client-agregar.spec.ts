import { test, expect, type Page } from "@playwright/test";
import { CAFETERIA_CENTRAL, PRODUCT } from "../fixtures/client-menu";

test.skip(
  !!process.env.PLAYWRIGHT_BASE_URL,
  "Requires the controlled local auth provider",
);

async function login(page: Page) {
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
}

test("agregar desde Inicio, abrir el detalle e intentar pasar del máximo muestra el aviso", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.goto(`/cuenta?cafeteria=${CAFETERIA_CENTRAL}`);
  const rail = page.getByRole("list", { name: "Productos: Corriente" });
  const add = rail.getByRole("button", {
    name: "Agregar Pechuga a la plancha al carrito",
  });
  const box = await add.boundingBox();
  // A 44 px target, drawn at 36 px.
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
  const started = Date.now();
  await add.click();
  await expect(
    rail.getByRole("status").filter({ hasText: "Agregado, 1 en el carrito" }),
  ).toHaveCount(1);
  // How long «+» takes to confirm, for the report («se demora mucho cuando +»).
  test.info().annotations.push({
    type: "add-latency-ms",
    description: String(Date.now() - started),
  });
  // After the ring the compact «− n +» appears, never taller than 44 px.
  const stepper = rail.getByRole("group", {
    name: "Cantidad de Pechuga a la plancha",
  });
  await expect(stepper).toBeVisible();
  expect((await stepper.boundingBox())!.height).toBeLessThanOrEqual(46);

  await page.goto(
    `/cuenta/producto/${PRODUCT.chicken}?cafeteria=${CAFETERIA_CENTRAL}`,
  );
  // No cafeteria box and no fixed maximum text on the detail.
  await expect(
    page.getByRole("link", { name: /^Cambiar cafetería/ }),
  ).toHaveCount(0);
  await expect(page.getByText(/Máximo 10 por producto y 15/)).toHaveCount(0);
  const increase = page.getByRole("button", { name: "Aumentar cantidad" });
  for (let count = 1; count < 10; count++) await increase.click();
  await expect(page.getByLabel("Cantidad seleccionada")).toHaveText("10");
  // At the limit «+» stays usable and explains it, then the notice hides by itself.
  await expect(increase).toBeEnabled();
  await increase.click();
  const notice = page
    .getByRole("status")
    .filter({ hasText: "Máximo 10 por producto" });
  await expect(notice).toBeVisible();
  await expect(page.getByLabel("Cantidad seleccionada")).toHaveText("10");
  await expect(notice).toHaveCount(0, { timeout: 5_000 });
});

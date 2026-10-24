import { test, expect, type Page } from "@playwright/test";
import { productImageFixture } from "../helpers/product-image-fixture.mjs";
const provider = "http://127.0.0.1:3101";
test.skip(!!process.env.PLAYWRIGHT_BASE_URL, "Requires owned local fixtures.");
async function config(
  page: Page,
  data: Record<string, unknown>,
  scope = "admin-catalog",
) {
  expect(
    (
      await page.request.post(provider + "/__test/" + scope, {
        data: { email: "admin@example.invalid", ...data },
      })
    ).status(),
  ).toBe(200);
}
async function open(page: Page) {
  await page.goto("/panel/login");
  await page
    .getByLabel("Usuario o correo institucional", { exact: true })
    .fill("admin@example.invalid");
  await page.getByLabel("Contraseña", { exact: true }).fill("UnaClave8");
  await page
    .getByRole("button", { name: "Iniciar sesión", exact: true })
    .click();
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto("/admin/catalogo");
  await expect(
    page.getByRole("button", { name: "Nuevo producto", exact: true }),
  ).toBeEnabled();
}
const dialog = (page: Page) => page.getByRole("dialog");
async function choose(page: Page) {
  await dialog(page)
    .getByLabel(/Seleccionar imagen|Reemplazar imagen/)
    .setInputFiles({
      name: "foto.png",
      mimeType: "image/png",
      buffer: productImageFixture(),
    });
  await expect(
    dialog(page).getByAltText("Vista previa de la imagen del producto"),
  ).toBeVisible();
}
async function audit(page: Page) {
  return (
    await page.request.get(
      provider + "/__test/admin-catalog?email=admin@example.invalid",
    )
  ).json();
}
test.beforeEach(async ({ page }) => {
  await config(page, { reset: true });
  await config(page, { reset: true }, "admin-profile");
});
test.afterEach(async ({ page }) => {
  await config(page, { reset: true });
  await config(page, { reset: true }, "admin-profile");
});

test("creation with image submits product once, associates with confirmed version, and renders private image", async ({
  page,
}) => {
  await open(page);
  await page
    .getByRole("button", { name: "Nuevo producto", exact: true })
    .click();
  await dialog(page)
    .getByLabel("Nombre", { exact: true })
    .fill("Producto con imagen");
  await dialog(page).getByLabel("Precio (COP)", { exact: true }).fill("15000");
  await choose(page);
  await dialog(page)
    .getByRole("button", { name: "Guardar producto", exact: true })
    .click();
  await expect(dialog(page)).toHaveCount(0);
  const image = page
    .getByRole("article", { name: "Producto con imagen", exact: true })
    .getByRole("img");
  await expect(image).toHaveAttribute(
    "src",
    /\/api\/admin\/catalog\/.+\/image\//,
  );
  await image.scrollIntoViewIfNeeded();
  await expect(image).toHaveJSProperty("naturalWidth", 300);
  const state = await audit(page);
  expect(state.mutations).toHaveLength(1);
  expect(state.imageMutations).toHaveLength(1);
  expect(state.imageMutations[0].expectedVersion).toBe("0");
});
test("commercial edit then image replacement uses consecutive confirmed versions", async ({
  page,
}) => {
  await open(page);
  await page
    .getByRole("button", { name: "Editar Ejecutivo de la casa", exact: true })
    .click();
  await dialog(page)
    .getByLabel("Nombre", { exact: true })
    .fill("Ejecutivo actualizado");
  await choose(page);
  await dialog(page)
    .getByRole("button", { name: "Guardar producto", exact: true })
    .click();
  await expect(dialog(page)).toHaveCount(0);
  const state = await audit(page);
  expect(state.mutations[0].body.expectedVersion).toBe("0");
  expect(state.imageMutations[0].expectedVersion).toBe("1");
});
test("partial creation failure preserves preview and safely retries only the same image attempt", async ({
  page,
}) => {
  await config(page, { imageMode: "503" });
  await open(page);
  await page
    .getByRole("button", { name: "Nuevo producto", exact: true })
    .click();
  await dialog(page)
    .getByLabel("Nombre", { exact: true })
    .fill("Producto parcial");
  await dialog(page).getByLabel("Precio (COP)", { exact: true }).fill("15000");
  await choose(page);
  await dialog(page)
    .getByRole("button", { name: "Guardar producto", exact: true })
    .click();
  await expect(
    dialog(page).getByRole("button", {
      name: "Comprobar resultado de imagen",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    dialog(page).getByAltText("Vista previa de la imagen del producto"),
  ).toBeVisible();
  await config(page, { imageMode: null });
  await dialog(page)
    .getByRole("button", { name: "Comprobar resultado de imagen", exact: true })
    .click();
  await dialog(page)
    .getByRole("button", {
      name: "Reenviar mismo intento de imagen",
      exact: true,
    })
    .click();
  await expect(dialog(page)).toHaveCount(0);
  const state = await audit(page);
  expect(state.mutations).toHaveLength(1);
  expect(state.imageMutations).toHaveLength(2);
  expect(state.imageMutations[0].key).toBe(state.imageMutations[1].key);
});
test("lost confirmation is recovered without another upload", async ({
  page,
}) => {
  await config(page, { imageMode: "disconnect-after-commit" });
  await open(page);
  await page
    .getByRole("button", { name: "Editar Corriente casero", exact: true })
    .click();
  await choose(page);
  await dialog(page)
    .getByRole("button", { name: "Guardar producto", exact: true })
    .click();
  await dialog(page)
    .getByRole("button", { name: "Comprobar resultado de imagen", exact: true })
    .click();
  await expect(dialog(page)).toHaveCount(0);
  expect((await audit(page)).imageMutations).toHaveLength(1);
});
test("remove is explicit, cancellation keeps legacy image and selection participates in dirty checking", async ({
  page,
}) => {
  await open(page);
  await page
    .getByRole("button", { name: "Editar Ejecutivo de la casa", exact: true })
    .click();
  await choose(page);
  await page.keyboard.press("Escape");
  await expect(
    dialog(page).getByRole("heading", { name: "¿Cerrar el editor?" }),
  ).toBeVisible();
  await dialog(page)
    .getByRole("button", { name: "Descartar borrador y cerrar", exact: true })
    .click();
  expect((await audit(page)).imageMutations).toHaveLength(0);
  await page
    .getByRole("button", { name: "Editar Ejecutivo de la casa", exact: true })
    .click();
  await dialog(page)
    .getByRole("button", { name: "Quitar imagen", exact: true })
    .click();
  await dialog(page)
    .getByRole("button", { name: "Guardar producto", exact: true })
    .click();
  await expect(dialog(page)).toHaveCount(0);
  expect((await audit(page)).imageMutations[0].method).toBe("DELETE");
});
test("pending upload prevents double submission and closing", async ({
  page,
}) => {
  await config(page, { imageMode: "slow" });
  await open(page);
  await page
    .getByRole("button", { name: "Editar Corriente casero", exact: true })
    .click();
  await choose(page);
  const save = dialog(page).getByRole("button", {
    name: "Guardar producto",
    exact: true,
  });
  await save.dblclick({ delay: 30 });
  await expect(
    dialog(page).getByRole("button", { name: "Cerrar editor", exact: true }),
  ).toBeDisabled();
  await expect(dialog(page)).toHaveCount(0);
  expect((await audit(page)).imageMutations).toHaveLength(1);
});
for (const width of [390, 768, 1366, 1920])
  test(`image controls fit and preserve keyboard focus at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await open(page);
    await page
      .getByRole("button", { name: "Editar Corriente casero", exact: true })
      .click();
    await choose(page);
    await expect(
      dialog(page).getByLabel("Seleccionar imagen", { exact: true }),
    ).toHaveAttribute("accept", "image/jpeg,image/png");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    expect(
      await dialog(page).evaluate(
        (node) => node.scrollWidth <= node.clientWidth,
      ),
    ).toBe(true);
    await dialog(page)
      .getByRole("button", { name: "Cerrar editor", exact: true })
      .focus();
    await page.keyboard.press("Shift+Tab");
    await expect(
      dialog(page).getByRole("button", {
        name: "Guardar producto",
        exact: true,
      }),
    ).toBeFocused();
  });

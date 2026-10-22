import { test, expect, type Page } from "@playwright/test";
import { adminProfileBusinessFixture } from "../helpers/admin-profile-fixture.mjs";

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
const drawer = (page: Page) => page.getByRole("dialog");
const create = async (page: Page, name = "Producto nuevo") => {
  await page
    .getByRole("button", { name: "Nuevo producto", exact: true })
    .click();
  await drawer(page).getByLabel("Nombre", { exact: true }).fill(name);
  await drawer(page)
    .getByLabel("Precio (COP)", { exact: true })
    .fill("19750.25");
};
const audit = async (page: Page) =>
  (
    await page.request.get(
      provider + "/__test/admin-catalog?email=admin@example.invalid",
    )
  ).json();
test.beforeEach(async ({ page }) => {
  await config(page, { reset: true });
  await config(page, { reset: true }, "admin-profile");
});
test.afterEach(async ({ page }) => {
  await config(page, { reset: true });
  await config(page, { reset: true }, "admin-profile");
});
test("create confirms once, applies exact representation and preserves search filters", async ({
  page,
}) => {
  await open(page);
  await page.getByLabel("Buscar productos").fill("nuevo");
  await create(page);
  await drawer(page)
    .getByRole("button", { name: "Guardar producto", exact: true })
    .click();
  await expect(drawer(page)).toHaveCount(0);
  await expect(
    page.getByRole("article", { name: "Producto nuevo", exact: true }),
  ).toContainText("$ 19.750");
  await expect(page.getByLabel("Buscar productos")).toHaveValue("nuevo");
  expect((await audit(page)).mutations).toHaveLength(1);
});
test("edit uses original cents and native modal keyboard focus stays inside until Escape", async ({
  page,
}) => {
  await open(page);
  const trigger = page.getByRole("button", {
    name: "Editar Ejecutivo de la casa",
    exact: true,
  });
  await trigger.click();
  await expect(drawer(page).getByLabel("Precio (COP)")).toHaveValue("18500.25");
  const first = drawer(page).getByRole("button", {
    name: "Cerrar editor",
    exact: true,
  });
  await first.focus();
  await page.keyboard.press("Shift+Tab");
  await expect(
    drawer(page).getByRole("button", { name: "Guardar producto", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(first).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(drawer(page)).toHaveCount(0);
  await expect(trigger).toBeFocused();
});
test("edit confirms all commercial fields and uses the original expected version", async ({
  page,
}) => {
  await open(page);
  await page
    .getByRole("button", { name: "Editar Ejecutivo de la casa", exact: true })
    .click();
  await drawer(page)
    .getByLabel("Nombre", { exact: true })
    .fill("Ejecutivo actualizado");
  await drawer(page)
    .getByLabel("Descripción (opcional)", { exact: true })
    .fill("Descripción actualizada");
  await drawer(page)
    .getByLabel("Precio (COP)", { exact: true })
    .fill("6500.50");
  await drawer(page)
    .getByRole("combobox", { name: "Categoría del producto", exact: true })
    .selectOption("ESPECIAL");
  await drawer(page)
    .getByRole("button", { name: "Guardar producto", exact: true })
    .click();
  await expect(drawer(page)).toHaveCount(0);
  const card = page.getByRole("article", {
    name: "Ejecutivo actualizado",
    exact: true,
  });
  await expect(card).toContainText("$ 6.501");
  await expect(card).toContainText("Descripción actualizada");
  await expect(card).toContainText("Especial");
  await expect(card).toContainText("Activo");
  const writes = (await audit(page)).mutations;
  expect(writes).toHaveLength(1);
  expect(writes[0].body).toEqual({
    name: "Ejecutivo actualizado",
    description: "Descripción actualizada",
    price: "6500.50",
    category: "ESPECIAL",
    expectedVersion: "0",
  });
});

test("invalid form shows field errors without a write; dirty Escape requires explicit discard", async ({
  page,
}) => {
  await open(page);
  await page
    .getByRole("button", { name: "Nuevo producto", exact: true })
    .click();
  await drawer(page)
    .getByRole("button", { name: "Guardar producto", exact: true })
    .click();
  await expect(
    drawer(page).getByText("Escribe un nombre de hasta 150 caracteres."),
  ).toBeVisible();
  expect((await audit(page)).mutations).toHaveLength(0);
  await drawer(page).getByLabel("Nombre", { exact: true }).fill("Borrador");
  await page.keyboard.press("Escape");
  await expect(drawer(page).getByText("¿Cerrar el editor?")).toBeVisible();
  await drawer(page)
    .getByRole("button", { name: "Seguir revisando", exact: true })
    .click();
  await expect(drawer(page).getByLabel("Nombre", { exact: true })).toHaveValue(
    "Borrador",
  );
  await page.keyboard.press("Escape");
  await drawer(page)
    .getByRole("button", { name: "Descartar borrador y cerrar", exact: true })
    .click();
  await expect(drawer(page)).toHaveCount(0);
});
test("deactivation requires confirmation and returns stable focus if active filter removes its trigger", async ({
  page,
}) => {
  await open(page);
  await page
    .getByRole("combobox", { name: "Estado", exact: true })
    .selectOption("active");
  await page
    .getByRole("button", {
      name: "Desactivar Ejecutivo de la casa",
      exact: true,
    })
    .click();
  expect((await audit(page)).mutations).toHaveLength(0);
  await drawer(page)
    .getByRole("button", { name: "Cancelar", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Desactivar Ejecutivo de la casa",
      exact: true,
    })
    .click();
  await drawer(page)
    .getByRole("button", { name: "Confirmar desactivación", exact: true })
    .click();
  await expect(drawer(page)).toHaveCount(0);
  await expect(
    page.getByRole("article", { name: "Ejecutivo de la casa", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Catálogo", exact: true }),
  ).toBeFocused();
  expect((await audit(page)).mutations[0].body).toEqual({
    active: false,
    expectedVersion: "0",
  });
});
test("reactivation is explicit and explains the WORKER daily enable requirement", async ({
  page,
}) => {
  await open(page);
  await page
    .getByRole("button", { name: "Activar Corriente casero", exact: true })
    .click();
  await expect(drawer(page)).toContainText("WORKER deberá habilitarlo");
  await drawer(page)
    .getByRole("button", { name: "Confirmar activación", exact: true })
    .click();
  await expect(
    page.getByRole("article", { name: "Corriente casero", exact: true }),
  ).toContainText("Activo");
  expect((await audit(page)).mutations[0].body.active).toBe(true);
});
test("profile focus refresh retains an unsaved draft through temporary failure and recovery", async ({
  page,
}) => {
  await open(page);
  await create(page, "Borrador persistente");
  await config(page, { mode: "503" }, "admin-profile");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(drawer(page).getByLabel("Nombre", { exact: true })).toHaveValue(
    "Borrador persistente",
  );
  await expect(
    drawer(page).getByRole("button", { name: "Guardar producto", exact: true }),
  ).toBeDisabled();
  await config(page, { mode: null }, "admin-profile");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    drawer(page).getByRole("button", { name: "Guardar producto", exact: true }),
  ).toBeEnabled();
  await expect(drawer(page).getByLabel("Nombre", { exact: true })).toHaveValue(
    "Borrador persistente",
  );
  expect((await audit(page)).mutations).toHaveLength(0);
});
test("definitive authorization revocation removes editor and protected catalog", async ({
  page,
}) => {
  await open(page);
  await create(page, "Protected draft");
  await config(page, { inactive: true }, "admin-profile");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(drawer(page)).toHaveCount(0);
  await expect(page.getByRole("article")).toHaveCount(0);
  expect((await audit(page)).mutations).toHaveLength(0);
});
test("inactive cafeteria keeps read access and disables every write action", async ({
  page,
}) => {
  const data = adminProfileBusinessFixture();
  data.cafeteria.active = false;
  await config(page, { data }, "admin-profile");
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
  await expect(page.getByRole("article")).toHaveCount(5);
  for (const b of await page
    .getByRole("region", { name: "Catálogo", exact: true })
    .getByRole("button")
    .all())
    await expect(b).toBeDisabled();
});
test("stale conflict preserves draft, blocks resubmit and supports catalog reconciliation", async ({
  page,
}) => {
  await open(page);
  await config(page, { mutationMode: "409" });
  await create(page, "Conflict draft");
  await drawer(page)
    .getByRole("button", { name: "Guardar producto", exact: true })
    .click();
  await expect(drawer(page)).toContainText("El producto cambió");
  await expect(drawer(page).getByLabel("Nombre", { exact: true })).toHaveValue(
    "Conflict draft",
  );
  await expect(
    drawer(page).getByRole("button", { name: "Guardar producto", exact: true }),
  ).toBeDisabled();
  await drawer(page)
    .getByRole("button", { name: "Revisar catálogo", exact: true })
    .click();
  expect((await audit(page)).mutations).toHaveLength(1);
});
test("duplicate name remains editable with field-level safe error", async ({
  page,
}) => {
  await open(page);
  await create(page, "Ejecutivo de la casa");
  await drawer(page)
    .getByRole("button", { name: "Guardar producto", exact: true })
    .click();
  await expect(
    drawer(page).getByLabel("Nombre", { exact: true }),
  ).toHaveAttribute("aria-invalid", "true");
  await expect(drawer(page)).toContainText("Ya existe un producto");
  await expect(
    drawer(page).getByRole("button", { name: "Guardar producto", exact: true }),
  ).toBeEnabled();
});
test("double submit sends one request and success waits for confirmation", async ({
  page,
}) => {
  await open(page);
  await config(page, { mutationMode: "slow" });
  await create(page);
  await drawer(page)
    .getByRole("button", { name: "Guardar producto", exact: true })
    .click();
  await expect(
    drawer(page).getByRole("button", { name: "Guardando…", exact: true }),
  ).toBeDisabled();
  await expect(page.getByText("Producto creado.", { exact: true })).toHaveCount(
    0,
  );
  await expect(drawer(page)).toHaveCount(0);
  expect((await audit(page)).mutations).toHaveLength(1);
});
test("uncertain committed POST preserves draft, reports no false success and never auto-retries", async ({
  page,
}) => {
  await open(page);
  await config(page, { mutationMode: "disconnect-after-commit" });
  await create(page, "Resultado incierto");
  await drawer(page)
    .getByRole("button", { name: "Guardar producto", exact: true })
    .click();
  await expect(drawer(page)).toContainText("No pudimos confirmar el resultado");
  await expect(drawer(page).getByLabel("Nombre", { exact: true })).toHaveValue(
    "Resultado incierto",
  );
  await expect(page.getByText("Producto creado.", { exact: true })).toHaveCount(
    0,
  );
  await drawer(page)
    .getByRole("button", { name: "Revisar catálogo", exact: true })
    .click();
  await expect(
    page.getByRole("article", { name: "Resultado incierto", exact: true }),
  ).toHaveCount(1);
  expect((await audit(page)).mutations).toHaveLength(1);
});
for (const width of [390, 768, 1366, 1920])
  test(
    "editor layout fits " + width + "px with no horizontal overflow",
    async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await open(page);
      await create(page);
      await expect(drawer(page)).toBeVisible();
      const size = await drawer(page).boundingBox();
      expect(size!.width).toBeLessThanOrEqual(width);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      expect(
        await drawer(page).evaluate((e) => e.scrollWidth <= e.clientWidth),
      ).toBe(true);
      await page.screenshot({
        path:
          process.env.TEMP + "/unifood-catalog-management-" + width + ".png",
        fullPage: true,
      });
    },
  );

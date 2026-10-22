import { test, expect as baseExpect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { adminCatalogFixture } from "../helpers/admin-catalog-fixture.mjs";
import { adminProfileBusinessFixture } from "../helpers/admin-profile-fixture.mjs";

const expect = baseExpect.configure({ timeout: 20_000 });
const provider = "http://127.0.0.1:3101";
test.skip(
  !!process.env.PLAYWRIGHT_BASE_URL,
  "Requires controlled local Auth/backend fixtures.",
);
async function configure(
  page: Page,
  data: Record<string, unknown>,
  email = "admin@example.invalid",
) {
  expect(
    (
      await page.request.post(provider + "/__test/admin-catalog", {
        data: { email, ...data },
      })
    ).status(),
  ).toBe(200);
}
async function profile(page: Page, data: Record<string, unknown>) {
  expect(
    (
      await page.request.post(provider + "/__test/admin-profile", {
        data: { email: "admin@example.invalid", ...data },
      })
    ).status(),
  ).toBe(200);
}
async function login(page: Page, user = "admin", target = "/admin") {
  await page.goto(user === "client" ? "/login" : "/panel/login");
  await page
    .getByLabel("Usuario o correo institucional", { exact: true })
    .fill(user + "@example.invalid");
  await page.getByLabel("Contraseña", { exact: true }).fill("UnaClave8");
  await page
    .getByRole("button", { name: "Iniciar sesión", exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(target + "$"));
}
async function catalog(page: Page) {
  await login(page);
  await page.goto("/admin/catalogo");
  await expect(
    page.getByRole("article", { name: "Ejecutivo de la casa", exact: true }),
  ).toBeVisible();
}
const region = (page: Page) =>
  page.getByRole("region", { name: "Catálogo", exact: true });
const authCookies = async (page: Page) =>
  (await page.context().cookies()).filter((c) => c.name.includes("auth-token"));
test.beforeEach(async ({ page }) => {
  await configure(page, { reset: true });
  await configure(page, { reset: true }, "adminother@example.invalid");
  await profile(page, { reset: true });
});
test.afterEach(async ({ page }) => {
  await configure(page, { reset: true });
  await profile(page, { reset: true });
  await page.request.post(provider + "/__test/auth-failure", {
    data: { email: "admin@example.invalid", mode: null },
  });
});

test("catalog shows commercial fields, combines accent-insensitive filters locally, and keeps tenant selectors powerless", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const reads = await (
    await page.request.get(provider + "/__test/profile-audit")
  ).json();
  await catalog(page);
  const view = region(page);
  await expect(view.getByRole("article")).toHaveCount(5);
  await expect(view).not.toContainText(
    /Producto exclusivo|Eliminar|Disponible hoy/,
  );
  await expect(
    view.getByRole("button", { name: "Nuevo producto", exact: true }),
  ).toBeEnabled();
  await expect(
    view.getByRole("article", { name: "Ejecutivo de la casa" }),
  ).toContainText("$ 18.500");
  await expect(
    view.getByRole("article", { name: "Corriente casero" }),
  ).toContainText("Inactivo");
  const before = await (
    await page.request.get(
      provider + "/__test/admin-catalog?email=admin@example.invalid",
    )
  ).json();
  await view.getByLabel("Buscar productos").fill("CAFE");
  await expect(view.getByRole("article")).toHaveCount(1);
  await expect(view.getByRole("article")).toContainText("Desayuno con café");
  await view.getByLabel("Buscar productos").fill("CASERO");
  await view
    .getByRole("combobox", { name: "Categoría", exact: true })
    .selectOption("CORRIENTE");
  await view
    .getByRole("combobox", { name: "Estado", exact: true })
    .selectOption("inactive");
  await expect(view.getByRole("article")).toHaveCount(1);
  await expect(view.getByRole("article")).toContainText("Inactivo");
  await view
    .getByRole("combobox", { name: "Estado", exact: true })
    .selectOption("active");
  await expect(view.getByRole("status")).toContainText(
    "No encontramos productos",
  );
  await view.getByLabel("Buscar productos").fill("");
  await expect(view.getByRole("status")).toContainText("filtros seleccionados");
  await view
    .getByRole("combobox", { name: "Categoría", exact: true })
    .selectOption("");
  await view
    .getByRole("combobox", { name: "Estado", exact: true })
    .selectOption("all");
  await expect(view.getByRole("article")).toHaveCount(5);
  const after = await (
    await page.request.get(
      provider + "/__test/admin-catalog?email=admin@example.invalid",
    )
  ).json();
  expect(after.gets).toBe(before.gets);
  const response = await page.request.get(
    "/api/admin/catalog?cafeteriaId=FOREIGN&userId=FOREIGN&siteId=FOREIGN&institutionId=FOREIGN",
  );
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("no-store");
  expect(await response.json()).toEqual(adminCatalogFixture());
  expect(
    (await (await page.request.get(provider + "/__test/profile-audit")).json())
      .directBusinessReads,
  ).toBe(reads.directBusinessReads);
  expect(errors).toEqual([]);
});

test("another ADMIN gets only their own catalog and cannot select the first tenant", async ({
  page,
}) => {
  await login(page, "adminother");
  await page.goto("/admin/catalogo?cafeteriaId=FOREIGN");
  await expect(region(page).getByRole("article")).toHaveCount(1);
  await expect(region(page)).toContainText(
    "Producto exclusivo de otra cafetería",
  );
  await expect(region(page)).not.toContainText("Ejecutivo de la casa");
});

test("empty catalog is a distinct successful state", async ({ page }) => {
  await configure(page, { data: { products: [] } });
  await login(page);
  await page.goto("/admin/catalogo");
  await expect(region(page).getByRole("status")).toHaveText(
    "Aún no hay productos en el catálogo.",
  );
  await expect(region(page).getByRole("alert")).toHaveCount(0);
});

test("missing, unsupported and failed images use the safe placeholder", async ({
  page,
}) => {
  const data = adminCatalogFixture();
  data.products[0].imageUrl = "/missing-catalog-image.png";
  data.products[1].imageUrl = "https://unsupported.invalid/private.png";
  await configure(page, { data });
  let externalRequests = 0;
  page.on("request", (request) => {
    if (request.url().includes("unsupported.invalid")) externalRequests++;
  });
  await login(page);
  await page.goto("/admin/catalogo");
  for (const name of ["Ejecutivo de la casa", "Corriente casero"])
    await expect(
      page.getByRole("article", { name, exact: true }).getByText("Sin imagen"),
    ).toBeVisible();
  expect(externalRequests).toBe(0);
});

test("inactive cafeteria retains its shell warning and catalog access", async ({
  page,
}) => {
  const data = adminProfileBusinessFixture();
  data.cafeteria.active = false;
  await profile(page, { data });
  await catalog(page);
  await expect(
    page.getByText("La cafetería está inactiva.", { exact: true }),
  ).toBeVisible();
  await expect(region(page).getByRole("article")).toHaveCount(5);
  expect((await page.request.get("/api/admin/catalog")).status()).toBe(200);
});

test("loading is announced while the catalog request is pending", async ({
  page,
}) => {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/admin/catalog", async (route) => {
    await gate;
    await route.continue();
  });
  await login(page);
  await page.goto("/admin/catalogo");
  await expect(region(page).getByRole("status")).toHaveText(
    "Cargando el catálogo…",
  );
  await expect(region(page).getByRole("article")).toHaveCount(0);
  release();
  await expect(region(page).getByRole("article")).toHaveCount(5);
});

for (const status of [401, 403, 500, 503]) {
  test(
    "backend " + status + " has safe actions and preserves the session",
    async ({ page }) => {
      await configure(page, { mode: String(status) });
      await login(page);
      await page.goto("/admin/catalogo");
      const alert = region(page).getByRole("alert");
      await expect(alert).toBeVisible();
      await expect(alert).not.toContainText(/PRIVATE|SQL|SELECT/);
      await expect(region(page).getByRole("article")).toHaveCount(0);
      const before = await authCookies(page);
      const response = await page.request.get("/api/admin/catalog");
      expect(response.status()).toBe(status);
      expect(response.headers()["retry-after"]).toBe(
        status === 503 ? "9" : undefined,
      );
      expect(await authCookies(page)).toEqual(before);
      if (status === 401)
        await expect(
          alert.getByRole("link", { name: "Iniciar sesión" }),
        ).toHaveAttribute("href", "/panel/login");
      else if (status === 403)
        await expect(alert.getByRole("button")).toHaveCount(0);
      else {
        await configure(page, { mode: null });
        await alert.getByRole("button", { name: "Reintentar" }).click();
        await expect(region(page).getByRole("article")).toHaveCount(5);
      }
    },
  );
}

test("malformed catalog is an error, never a fabricated empty state", async ({
  page,
}) => {
  await configure(page, { data: { products: [{ id: "bad" }] } });
  await login(page);
  await page.goto("/admin/catalogo");
  await expect(region(page).getByRole("alert")).toContainText(
    "catálogo válido",
  );
  await expect(region(page)).not.toContainText("Aún no hay productos");
});

test("inactive business identity is 403; temporary Auth failures recover without logout", async ({
  page,
}) => {
  await catalog(page);
  const before = await authCookies(page);
  await profile(page, { inactive: true });
  expect((await page.request.get("/api/admin/catalog")).status()).toBe(403);
  await profile(page, { inactive: false });
  await page.request.post(provider + "/__test/auth-failure", {
    data: { email: "admin@example.invalid", mode: "profile" },
  });
  expect((await page.request.get("/api/admin/catalog")).status()).toBe(503);
  expect(await authCookies(page)).toEqual(before);
  await page.request.post(provider + "/__test/auth-failure", {
    data: { email: "admin@example.invalid", mode: null },
  });
  expect((await page.request.get("/api/admin/catalog")).status()).toBe(200);
});

for (const [user, target] of [
  ["client", "/cuenta"],
  ["worker", "/worker"],
  ["superadmin", "/super-admin"],
]) {
  test(
    user + " keeps its destination and cannot read catalog",
    async ({ page }) => {
      await login(page, user, target);
      await page.goto("/admin/catalogo");
      await expect(page).toHaveURL(new RegExp(target + "$"));
      expect((await page.request.get("/api/admin/catalog")).status()).toBe(403);
    },
  );
}

test("anonymous access is 401; existing logout blocks a later catalog read", async ({
  page,
}) => {
  expect((await page.request.get("/api/admin/catalog")).status()).toBe(401);
  await catalog(page);
  await page
    .getByRole("button", { name: "Cerrar sesión", exact: true })
    .click();
  await expect(page).toHaveURL(/\/panel\/login$/);
  expect((await page.request.get("/api/admin/catalog")).status()).toBe(401);
  await page.goto("/admin/catalogo");
  await expect(page).toHaveURL(/\/panel\/login$/);
});

for (const width of [390, 768, 1366, 1920]) {
  test(
    "catalog layout and keyboard controls at " + width + "px",
    async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await catalog(page);
      const view = region(page);
      const search = view.getByLabel("Buscar productos");
      await search.focus();
      await expect(search).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(
        view.getByRole("combobox", { name: "Categoría", exact: true }),
      ).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(
        view.getByRole("combobox", { name: "Estado", exact: true }),
      ).toBeFocused();
      const cards = await view.getByRole("article").evaluateAll((elements) =>
        elements.map((el) => {
          const bounds = el.getBoundingClientRect();
          return { x: bounds.x, y: bounds.y, width: bounds.width };
        }),
      );
      const expected =
        width === 390 ? 1 : width === 768 ? 2 : width === 1366 ? 3 : 4;
      expect(
        cards.filter((card) => Math.abs(card.y - cards[0].y) < 2),
      ).toHaveLength(expected);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      expect(
        await view.evaluate((el) => el.scrollWidth <= el.clientWidth),
      ).toBe(true);
      const toggle = page.getByRole("button", {
        name: "Abrir navegación",
        exact: true,
      });
      if (width < 1024) {
        await toggle.click();
        const drawer = page.getByRole("dialog", {
          name: "Navegación administrativa",
        });
        await expect(drawer).toBeVisible();
        await drawer
          .getByRole("link", { name: "Mi perfil", exact: true })
          .click();
      } else
        await page
          .getByRole("link", { name: "Mi perfil", exact: true })
          .click();
      await expect(page).toHaveURL(/\/admin\/perfil$/);
      await expect(
        page.getByText("admin@example.invalid", { exact: true }),
      ).toBeVisible();
      await page.goto("/admin/catalogo");
      await expect(region(page).getByRole("article")).toHaveCount(5);
      const directory = join(tmpdir(), "unifood-admin-catalog-visual");
      await mkdir(directory, { recursive: true });
      await page.screenshot({
        path: join(directory, String(width) + ".png"),
        fullPage: true,
      });
    },
  );
}

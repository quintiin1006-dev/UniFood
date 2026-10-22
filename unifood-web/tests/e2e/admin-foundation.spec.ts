import { test, expect as baseExpect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { adminProfileBusinessFixture } from "../helpers/admin-profile-fixture.mjs";

const expect = baseExpect.configure({ timeout: 20_000 });
const provider = "http://127.0.0.1:3101";
test.skip(
  !!process.env.PLAYWRIGHT_BASE_URL,
  "Requires the controlled local Auth/backend fixture.",
);

async function configure(page: Page, config: Record<string, unknown>) {
  expect(
    (
      await page.request.post(`${provider}/__test/admin-profile`, {
        data: { email: "admin@example.invalid", ...config },
      })
    ).status(),
  ).toBe(200);
}
async function login(page: Page, user = "admin", target = "/admin") {
  await page.goto(user === "client" ? "/login" : "/panel/login");
  await page
    .getByLabel("Usuario o correo institucional", { exact: true })
    .fill(`${user}@example.invalid`);
  await page.getByLabel("Contraseña", { exact: true }).fill("UnaClave8");
  await page
    .getByRole("button", { name: "Iniciar sesión", exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`${target}$`));
}
async function navigate(page: Page, name: string) {
  const toggle = page.getByRole("button", {
    name: "Abrir navegación",
    exact: true,
  });
  if (await toggle.isVisible()) await toggle.click();
  await page
    .getByRole("navigation", { name: "Administración", exact: true })
    .getByRole("link", { name, exact: true })
    .click();
}
async function ready(page: Page) {
  await expect(
    page.getByRole("banner").getByText("Cafetería Principal", { exact: true }),
  ).toBeVisible();
}
const cookies = async (page: Page) =>
  (await page.context().cookies()).filter((cookie) =>
    cookie.name.includes("auth-token"),
  );

test.beforeEach(async ({ page }) => {
  await configure(page, { reset: true });
});
test.afterEach(async ({ page }) => {
  await configure(page, { reset: true });
  await page.request.post(`${provider}/__test/auth-failure`, {
    data: { email: "admin@example.invalid", mode: null },
  });
});

test("ADMIN login, honest navigation, verified profile and existing panel logout", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  const before = await (
    await page.request.get(`${provider}/__test/profile-audit`)
  ).json();
  await login(page);
  await ready(page);
  await expect(
    page.getByRole("heading", { name: "Dashboard", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Próximamente", { exact: true })).toBeVisible();
  await navigate(page, "Catálogo");
  await expect(page).toHaveURL(/\/admin\/catalogo$/);
  await expect(
    page.getByRole("heading", { name: "Catálogo", exact: true }),
  ).toBeVisible();
  await navigate(page, "Mi perfil");
  await expect(page).toHaveURL(/\/admin\/perfil$/);
  const profile = page.getByRole("region", { name: "Mi perfil", exact: true });
  for (const text of [
    "admin@example.invalid",
    "Administrador",
    "Cafetería Principal",
    "Activa",
    "Sede Villavicencio",
    "Universidad de prueba",
  ]) {
    await expect(profile.getByText(text, { exact: true })).toBeVisible();
  }
  await expect(profile).not.toContainText(
    /PRIVATE|business-email-is-not-auth|documento|teléfono|metadata|UUID/i,
  );
  await expect(profile.locator("input, form, button")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Cerrar sesión", exact: true }),
  ).toHaveCount(1);
  const response = await page.request.get(
    "/api/admin/profile?userId=FOREIGN&cafeteriaId=FOREIGN&email=forged@example.invalid",
  );
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("no-store");
  expect(await response.json()).toEqual({
    email: "admin@example.invalid",
    ...adminProfileBusinessFixture(),
  });
  const after = await (
    await page.request.get(`${provider}/__test/profile-audit`)
  ).json();
  expect(after.directBusinessReads).toBe(before.directBusinessReads);
  await page
    .getByRole("button", { name: "Cerrar sesión", exact: true })
    .click();
  await expect(page).toHaveURL(/\/panel\/login$/);
  await page.goto("/admin/perfil");
  await expect(page).toHaveURL(/\/panel\/login$/);
  expect(
    errors.filter((error) => /hydrat|uncaught|didn't match/i.test(error)),
  ).toEqual([]);
});

test("inactive cafeteria remains readable and the warning persists across all surfaces", async ({
  page,
}) => {
  const data = adminProfileBusinessFixture();
  data.cafeteria.active = false;
  await configure(page, { data });
  await login(page);
  for (const name of ["Dashboard", "Catálogo", "Mi perfil"]) {
    if (name !== "Dashboard") await navigate(page, name);
    await expect(page.getByRole("status")).toContainText(
      "La cafetería está inactiva.",
    );
    await expect(page.getByRole("status")).toContainText(
      "los cambios están deshabilitados",
    );
    await expect(
      page.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
  }
  await expect(page.getByText("Inactiva", { exact: true })).toBeVisible();
  await expect(
    page.getByText("admin@example.invalid", { exact: true }),
  ).toBeVisible();
});

for (const width of [390, 768, 1366, 1920]) {
  test(`ADMIN ${width}px: responsive navigation, keyboard drawer and no overflow`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await login(page);
    await ready(page);
    const toggle = page.getByRole("button", {
      name: "Abrir navegación",
      exact: true,
    });
    if (width < 1024) {
      await expect(toggle).toBeVisible();
      await toggle.focus();
      await page.keyboard.press("Enter");
      const drawer = page.getByRole("dialog", {
        name: "Navegación administrativa",
      });
      await expect(drawer).toBeVisible();
      for (let i = 0; i < 7; i++) {
        await page.keyboard.press("Tab");
        expect(
          await drawer.evaluate((el) => el.contains(document.activeElement)),
        ).toBe(true);
      }
      await drawer.getByRole("button", { name: "Cerrar navegación" }).focus();
      await page.keyboard.press("Shift+Tab");
      await expect(
        drawer.getByRole("link", { name: "Mi perfil", exact: true }),
      ).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(drawer).not.toBeVisible();
      await expect(toggle).toBeFocused();
    } else {
      await expect(toggle).not.toBeVisible();
      await expect(
        page.getByRole("navigation", { name: "Administración", exact: true }),
      ).toBeVisible();
    }
    await navigate(page, "Mi perfil");
    await expect(
      page.getByText("admin@example.invalid", { exact: true }),
    ).toBeVisible();
    if (width >= 1024)
      await expect(
        page.getByRole("link", { name: "Mi perfil", exact: true }),
      ).toHaveAttribute("aria-current", "page");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    const region = page.getByRole("region", { name: "Mi perfil", exact: true });
    expect(
      await region.evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    const directory = join(tmpdir(), "unifood-admin-foundation-visual");
    await mkdir(directory, { recursive: true });
    await page.screenshot({
      path: join(directory, `${width}-profile.png`),
      fullPage: true,
    });
  });
}

for (const [user, target] of [
  ["client", "/cuenta"],
  ["worker", "/worker"],
  ["superadmin", "/super-admin"],
]) {
  test(`${user} keeps its role destination and cannot read an ADMIN profile`, async ({
    page,
  }) => {
    await login(page, user, target);
    for (const route of ["/admin", "/admin/catalogo", "/admin/perfil"]) {
      await page.goto(route);
      await expect(page).toHaveURL(new RegExp(`${target}$`));
    }
    expect((await page.request.get("/api/admin/profile")).status()).toBe(403);
  });
}

for (const status of [401, 403, 500, 503]) {
  test(`backend ${status}: safe error, correct actions and recovery`, async ({
    page,
  }) => {
    await login(page);
    await ready(page);
    const before = await cookies(page);
    await configure(page, { mode: String(status) });
    await navigate(page, "Mi perfil");
    const alert = page.getByRole("main").getByRole("alert");
    await expect(alert).toBeVisible();
    await expect(alert).not.toContainText(/PRIVATE|SQL|SELECT/);
    await expect(
      page.getByRole("region", { name: "Mi perfil", exact: true }),
    ).toHaveCount(status === 401 || status === 403 ? 0 : 1);
    if (status >= 500)
      await expect(
        page.getByText("admin@example.invalid", { exact: true }),
      ).toBeVisible();
    const response = await page.request.get("/api/admin/profile");
    expect(response.status()).toBe(status);
    expect(response.headers()["retry-after"]).toBe(
      status === 503 ? "9" : undefined,
    );
    expect(await cookies(page)).toEqual(before);
    if (status === 401)
      await expect(
        alert.getByRole("link", { name: "Iniciar sesión" }),
      ).toBeVisible();
    else if (status === 403)
      await expect(alert.getByRole("button")).toHaveCount(0);
    else {
      await configure(page, { mode: null });
      const recovered = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === "/api/admin/profile" &&
          response.status() === 200,
      );
      await alert.getByRole("button", { name: "Reintentar" }).click();
      await recovered;
      await expect(
        page.getByText("admin@example.invalid", { exact: true }),
      ).toBeVisible();
    }
  });
}

test("inactive business user is 403 and temporary Auth failure retains the session", async ({
  page,
}) => {
  await login(page);
  await ready(page);
  const before = await cookies(page);
  await configure(page, { inactive: true });
  expect((await page.request.get("/api/admin/profile")).status()).toBe(403);
  await configure(page, { inactive: false });
  await page.request.post(`${provider}/__test/auth-failure`, {
    data: { email: "admin@example.invalid", mode: "profile" },
  });
  const response = await page.request.get("/api/admin/profile");
  expect(response.status()).toBe(503);
  expect(response.headers()["retry-after"]).toBe("5");
  expect(await cookies(page)).toEqual(before);
  await page.request.post(`${provider}/__test/auth-failure`, {
    data: { email: "admin@example.invalid", mode: null },
  });
  expect((await page.request.get("/api/admin/profile")).status()).toBe(200);
});

test("anonymous requests are 401 and loading never fabricates a profile", async ({
  page,
}) => {
  expect((await page.request.get("/api/admin/profile")).status()).toBe(401);
  let release: () => void = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/admin/profile", async (route) => {
    await pending;
    await route.continue();
  });
  await login(page);
  await expect(page.getByRole("status")).toContainText("Cargando tu espacio");
  await expect(
    page.getByRole("heading", { name: "Dashboard", exact: true }),
  ).toHaveCount(0);
  release();
  await ready(page);
});

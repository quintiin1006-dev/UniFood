import { test, expect as baseExpect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { workerProfileBusinessFixture } from "../helpers/worker-profile-fixture.mjs";

const expect = baseExpect.configure({ timeout: 20_000 });
test.skip(
  !!process.env.PLAYWRIGHT_BASE_URL,
  "Requires the controlled local Auth/backend fixture.",
);
const provider = "http://127.0.0.1:3101";
const root = "/api/worker/profile";
const panel = (page: Page) =>
  page.getByRole("region", { name: "Mi perfil", exact: true });
async function configure(page: Page, config: Record<string, unknown>) {
  expect(
    (
      await page.request.post(`${provider}/__test/worker-profile`, {
        data: { email: "worker@example.invalid", ...config },
      })
    ).status(),
  ).toBe(200);
}
async function providerFailure(page: Page, mode: string | null) {
  expect(
    (
      await page.request.post(`${provider}/__test/auth-failure`, {
        data: { email: "worker@example.invalid", mode },
      })
    ).status(),
  ).toBe(200);
}
async function login(page: Page, email = "worker@example.invalid") {
  await page.goto(email.startsWith("client") ? "/login" : "/panel/login");
  await page
    .getByLabel("Usuario o correo institucional", { exact: true })
    .fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill("UnaClave8");
  await page
    .getByRole("button", { name: "Iniciar sesión", exact: true })
    .click();
  await expect(page).toHaveURL(
    email.startsWith("client") ? /\/cuenta$/ : /\/worker$/,
  );
}
async function enter(page: Page) {
  await page.getByRole("button", { name: "Mi perfil", exact: true }).click();
  await expect(panel(page)).toBeVisible();
}
async function loaded(page: Page) {
  await expect(
    panel(page).getByText("worker@example.invalid", { exact: true }),
  ).toBeVisible();
  await expect(
    panel(page).getByText("Trabajador", { exact: true }),
  ).toBeVisible();
}
const sessionCookies = async (page: Page) =>
  (await page.context().cookies()).filter((cookie) =>
    cookie.name.includes("auth-token"),
  );
test.beforeEach(async ({ page }) => {
  await configure(page, { reset: true });
  await providerFailure(page, null);
});
test.afterEach(async ({ page }) => {
  await configure(page, { reset: true });
  await providerFailure(page, null);
});

test("WORKER profile displays Auth email and employment context without personal fields or a second logout", async ({
  page,
}) => {
  const before = await (
    await page.request.get(`${provider}/__test/profile-audit`)
  ).json();
  await login(page);
  await enter(page);
  await loaded(page);
  for (const text of [
    "Cafetería Principal",
    "Sede Villavicencio",
    "Universidad de prueba",
  ])
    await expect(panel(page).getByText(text, { exact: true })).toBeVisible();
  await expect(panel(page)).not.toContainText(
    /Usuario|documento|teléfono|business-email-is-not-auth|PRIVATE/i,
  );
  await expect(panel(page).locator("input, form")).toHaveCount(0);
  await expect(
    panel(page).getByRole("button", {
      name: /Editar|Guardar|contraseña|foto|Cerrar sesión/i,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Cerrar sesión", exact: true }),
  ).toHaveCount(1);
  expect(await panel(page).locator("dl dt").count()).toBe(5);
  const response = await page.request.get(
    `${root}?userId=FOREIGN&email=forged@browser.invalid&cafeteriaId=FOREIGN&siteId=FOREIGN&institutionId=FOREIGN`,
  );
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("no-store");
  expect(await response.json()).toEqual({
    email: "worker@example.invalid",
    ...workerProfileBusinessFixture(),
  });
  const after = await (
    await page.request.get(`${provider}/__test/profile-audit`)
  ).json();
  expect(after.directBusinessReads).toBe(before.directBusinessReads);
});
test("inactive cafeteria is readable and explicitly described", async ({
  page,
}) => {
  const data = workerProfileBusinessFixture();
  data.cafeteria.active = false;
  await configure(page, { data });
  await login(page);
  await enter(page);
  await loaded(page);
  await expect(panel(page).getByRole("status")).toContainText(
    "Esta cafetería está administrativamente inactiva.",
  );
});
test("Spring 503 preserves cookies, Retry-After and recovers through retry", async ({
  page,
}) => {
  await login(page);
  const cookies = await sessionCookies(page);
  expect(cookies.length).toBeGreaterThan(0);
  await configure(page, { mode: "503" });
  await enter(page);
  await expect(panel(page).getByRole("alert")).toContainText(
    "No pudimos cargar tu perfil en este momento.",
  );
  expect(await sessionCookies(page)).toEqual(cookies);
  const response = await page.request.get(root);
  expect(response.status()).toBe(503);
  expect(response.headers()["retry-after"]).toBe("9");
  await configure(page, { mode: null });
  await panel(page)
    .getByRole("button", { name: "Reintentar", exact: true })
    .click();
  await loaded(page);
  await expect(page).toHaveURL(/\/worker$/);
});
test("temporary provider and RPC failures retain the session and recover without login", async ({
  page,
}) => {
  await login(page);
  const cookies = await sessionCookies(page);
  for (const mode of ["503", "profile"]) {
    await providerFailure(page, mode);
    const response = await page.request.get(root);
    expect(response.status()).toBe(503);
    expect(response.headers()["set-cookie"]).toBeUndefined();
    expect(await sessionCookies(page)).toEqual(cookies);
    await providerFailure(page, null);
    expect((await page.request.get(root)).status()).toBe(200);
  }
  await enter(page);
  await loaded(page);
});
test("authenticated activity revocation is 403, not 401, without destroying the session", async ({
  page,
}) => {
  await login(page);
  const cookies = await sessionCookies(page);
  await configure(page, { inactive: true });
  expect((await page.request.get(root)).status()).toBe(403);
  await enter(page);
  await expect(panel(page).getByRole("alert")).toContainText(
    "No tienes permisos",
  );
  await expect(
    panel(page).getByRole("link", { name: "Iniciar sesión" }),
  ).toHaveCount(0);
  await expect(
    panel(page).getByRole("button", { name: "Reintentar" }),
  ).toHaveCount(0);
  expect(await sessionCookies(page)).toEqual(cookies);
  await expect(page).toHaveURL(/\/worker$/);
});
test("anonymous request is 401 and a CLIENT session is 403", async ({
  page,
}) => {
  expect((await page.request.get(root)).status()).toBe(401);
  await login(page, "client@example.invalid");
  expect((await page.request.get(root)).status()).toBe(403);
  await expect(page).toHaveURL(/\/cuenta$/);
});
for (const status of [401, 403, 500])
  test(`Spring ${status} shows safe contextual controls`, async ({ page }) => {
    await configure(page, { mode: String(status) });
    await login(page);
    await enter(page);
    await expect(panel(page).getByRole("alert")).toBeVisible();
    await expect(panel(page)).not.toContainText("PRIVATE");
    if (status === 401)
      await expect(
        panel(page).getByRole("link", { name: "Iniciar sesión" }),
      ).toHaveAttribute("href", "/panel/login");
    else if (status === 403)
      await expect(
        panel(page).getByRole("button", { name: "Reintentar" }),
      ).toHaveCount(0);
    else
      await expect(
        panel(page).getByRole("button", { name: "Reintentar" }),
      ).toBeVisible();
    await expect(page).toHaveURL(/\/worker$/);
  });
test("loading is accessible and a malformed contract fails completely then recovers", async ({
  page,
}) => {
  await login(page);
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**${root}`, async (route) => {
    await wait;
    await route.continue();
  });
  await enter(page);
  await expect(panel(page).getByRole("status")).toContainText(
    "Cargando tu perfil",
  );
  release();
  await loaded(page);
  await page.unroute(`**${root}`);
  await configure(page, { data: { role: "WORKER" } });
  await page.getByRole("button", { name: "Pedidos", exact: true }).click();
  await enter(page);
  await expect(panel(page).getByRole("alert")).toContainText(
    "No pudimos cargar un perfil válido",
  );
  await expect(panel(page).getByText("worker@example.invalid")).toHaveCount(0);
  await configure(page, { reset: true });
  await panel(page).getByRole("button", { name: "Reintentar" }).click();
  await loaded(page);
});
test("existing worker modules remain reachable and Header logout returns to panel login", async ({
  page,
}) => {
  await login(page);
  await enter(page);
  await loaded(page);
  await page
    .getByRole("button", { name: "Disponibilidad", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Disponibilidad", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Historial", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Historial", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Pedidos", exact: true }).click();
  await expect(
    page.getByText("Estudiante de prueba", { exact: true }),
  ).toBeVisible();
  await enter(page);
  await loaded(page);
  await page
    .getByRole("button", { name: "Cerrar sesión", exact: true })
    .click();
  await expect(page).toHaveURL(/\/panel\/login$/);
  expect(await sessionCookies(page)).toHaveLength(0);
  await page.goto("/worker");
  await expect(page).toHaveURL(/\/panel\/login$/);
});
for (const width of [390, 768, 1366])
  test(`profile wraps long values and keeps navigation reachable at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    const data = workerProfileBusinessFixture();
    data.cafeteria.name = "Cafetería".repeat(15);
    data.site.name = "Sede".repeat(25);
    data.institution.name = "Institución".repeat(20);
    data.cafeteria.active = false;
    await configure(page, { data });
    await login(page);
    await page.route(`**${root}`, async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      // Test layout for a valid long email without changing identity authority at the BFF.
      body.email = `${"trabajador".repeat(7)}@${"institucion".repeat(5)}.example.invalid`;
      await route.fulfill({ response, json: body });
    });
    await enter(page);
    await expect(
      panel(page).getByText("Trabajador", { exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      await panel(page).evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    const nav = page.getByRole("button", { name: "Mi perfil", exact: true });
    await expect(nav).toBeInViewport();
    await panel(page).getByRole("status").scrollIntoViewIfNeeded();
    await expect(panel(page).getByRole("status")).toBeVisible();
    const navBox = await nav.boundingBox();
    const notice = await panel(page).getByRole("status").boundingBox();
    expect(notice!.y + notice!.height).toBeLessThanOrEqual(navBox!.y + 1);
    const screenshotDir = join(tmpdir(), "unifood-worker-profile-review");
    await mkdir(screenshotDir, { recursive: true });
    await page.addStyleTag({
      content: "nextjs-portal { visibility: hidden !important; }",
    });
    await page.screenshot({
      path: join(screenshotDir, `profile-${width}.png`),
    });
  });

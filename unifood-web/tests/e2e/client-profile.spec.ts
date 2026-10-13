import { test, expect, type Page } from "@playwright/test";

test.skip(
  !!process.env.PLAYWRIGHT_BASE_URL,
  "Requires controlled local providers.",
);
const provider = "http://127.0.0.1:3101";

async function login(page: Page) {
  await page.goto("/login");
  await page
    .getByLabel("Usuario o correo institucional", { exact: true })
    .fill("client@example.invalid");
  await page.getByLabel("Contraseña", { exact: true }).fill("UnaClave8");
  await page
    .getByRole("button", { name: "Iniciar sesión", exact: true })
    .click();
  await expect(page).toHaveURL(/\/cuenta$/);
}

test("CLIENT profile reads business fields through Spring while direct Supabase REST is closed", async ({
  page,
}) => {
  await login(page);
  const response = await page.goto("/cuenta/perfil");
  // Next dev uses no-cache; production dynamic pages also include no-store.
  const cacheControl = response?.headers()["cache-control"] ?? "";
  expect(cacheControl).toMatch(/(?:no-cache|no-store)/);
  expect(cacheControl).not.toMatch(/(?:public|s-maxage)/);
  await expect(page.getByRole("heading", { name: "Mi perfil" })).toBeVisible();
  await expect(
    page.getByRole("main").getByText("1234567890", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("main").getByText("Sin registrar", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("main").getByText("Universidad de prueba", { exact: true }),
  ).toHaveCount(2);
  const audit = await (
    await page.request.get(provider + "/__test/profile-audit")
  ).json();
  expect(audit.directBusinessReads).toBe(0);
  expect(audit.backendProfileReads).toBeGreaterThan(0);
});

test("temporary profile backend failure keeps cookies and recovers on the same page without login", async ({
  page,
}) => {
  await login(page);
  await page.goto("/cuenta/perfil");
  await expect(
    page.getByRole("main").getByText("1234567890", { exact: true }),
  ).toBeVisible();
  const cookies = await page.context().cookies();
  try {
    const failure = await page.request.post(provider + "/__test/auth-failure", {
      data: { email: "client@example.invalid", mode: "backend-profile" },
    });
    expect(failure.ok()).toBe(true);
    await page.reload();
    await expect(page).toHaveURL(/\/cuenta\/perfil$/);
    await expect(page.getByRole("main").getByRole("status")).toContainText(
      "No pudimos cargar todos los datos de tu perfil",
    );
    expect(await page.content()).not.toContain(
      "PRIVATE_BACKEND_PROFILE_DETAIL",
    );
    expect(await page.context().cookies()).toEqual(cookies);
  } finally {
    await page.request.post(provider + "/__test/auth-failure", {
      data: { email: "client@example.invalid", mode: null },
    });
  }
  await page.reload();
  await expect(page).toHaveURL(/\/cuenta\/perfil$/);
  await expect(
    page.getByRole("main").getByText("1234567890", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("main").getByRole("status")).toHaveCount(0);
  await page.goto("/cuenta");
  await expect(
    page.getByRole("heading", { name: "¿Dónde vas a pedir hoy?" }),
  ).toBeVisible();
});

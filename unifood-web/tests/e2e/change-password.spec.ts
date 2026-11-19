import { test, expect, type Page } from "@playwright/test";

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

test("cambiar contraseña: enviar código, ver el aviso y pasar al paso 2", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.goto("/cuenta/perfil/contrasena");
  // Step 1: the known address and a single action; no code or password fields yet.
  await expect(
    page.getByRole("heading", { name: "Cambiar contraseña" }),
  ).toBeVisible();
  await expect(page.getByText("client@example.invalid")).toBeVisible();
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Enviar código de verificación" })
    .click();

  // Step 2, with the confirmation toast on top.
  await expect(page).toHaveURL(/\/recuperar-contrasena/);
  const toast = page
    .getByRole("status")
    .filter({
      hasText: "Te enviamos un código de verificación a tu correo registrado",
    });
  await expect(toast).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Código de verificación", exact: true }),
  ).toHaveAttribute("autocomplete", "one-time-code");
  await expect(
    page.getByLabel("Nueva contraseña", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Confirmar nueva contraseña", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Cambiar contraseña", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^Reenviar código en \d+ s$/ }),
  ).toBeDisabled();
  // The toast hides by itself.
  await expect(toast).toHaveCount(0, { timeout: 7_000 });
});

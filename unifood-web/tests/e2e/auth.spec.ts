import { test, expect } from "@playwright/test";

test("mobile login: password visibility, remember, language and responsive layout", async ({ page }, testInfo) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Tu comida, sin filas" })).toBeVisible();
  const password = page.getByLabel("Contraseña", { exact: true });
  await password.fill("ClaveSegura8");
  await page.getByRole("button", { name: "Mostrar contraseña" }).click();
  await expect(password).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "Ocultar contraseña" }).click();
  await expect(password).toHaveAttribute("type", "password");
  await page.getByRole("checkbox").uncheck();
  await expect(page.getByRole("checkbox")).not.toBeChecked();
  await page.getByRole("combobox").selectOption("en");
  await expect(page.getByRole("heading", { name: "Your food, no waiting" })).toBeVisible();
  await page.getByRole("combobox").selectOption("es");
  await password.clear();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("login-mobile.png"), fullPage: true });
});

for (const domain of ["ustavillavo.edu.co", "ustavillavicencio.edu.co"]) {
test(`registration validates each step and supports pasting an OTP for ${domain}`, async ({ page }, testInfo) => {
  const requests: { action: string; body: Record<string, unknown> }[] = [];
  await page.route("**/api/auth/*", async (route) => {
    const action = route.request().url().split("/").at(-1)!;
    requests.push({ action, body: route.request().postDataJSON() });
    await route.fulfill({ status: action === "verify" ? 400 : 200, json: action === "verify" ? { message: "El código no es válido o ya venció." } : { ok: true } });
  });
  await page.goto("/registro");
  await page.getByRole("textbox", { name: "Nombre completo" }).fill("María Pérez");
  await page.getByRole("textbox", { name: "Número de documento" }).fill("12.345");
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("sin espacios ni puntos");
  await page.getByRole("textbox", { name: "Número de documento" }).fill("123456789");
  await page.screenshot({ path: testInfo.outputPath("register-personal.png"), fullPage: true });
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByText("Usa tu correo @ustavillavo.edu.co o @ustavillavicencio.edu.co.", { exact: true })).toBeVisible();
  await page.getByRole("textbox").fill(`maria@${domain}`);
  await page.screenshot({ path: testInfo.outputPath("register-email.png"), fullPage: true });
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.getByLabel("Contraseña", { exact: true }).fill("UnaClave8");
  await page.getByLabel("Confirmar contraseña", { exact: true }).fill("OtraClave8");
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("no coinciden");
  await page.getByLabel("Confirmar contraseña", { exact: true }).fill("UnaClave8");
  await page.screenshot({ path: testInfo.outputPath("register-password.png"), fullPage: true });
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByRole("heading", { name: "Verifica tu correo" })).toBeVisible();
  await expect(page.getByText(`maria@${domain}`, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Reenviar código/ })).toBeDisabled();
  await page.getByRole("textbox", { name: "Dígito 1", exact: true }).fill("123456");
  await expect(page.getByRole("textbox", { name: "Dígito 6", exact: true })).toHaveValue("6");
  await page.screenshot({ path: testInfo.outputPath("register-verify.png"), fullPage: true });
  await page.getByRole("button", { name: "Verificar", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("no es válido");
  expect(requests.map(({ action }) => action)).toEqual(["institution", "register", "verify"]);
  expect(requests.at(-1)?.body.code).toBe("123456");
  expect(requests.every(({ body }) => body.email === `maria@${domain}`)).toBe(true);
});
}

test("registration stays on email when the institutional domain is rejected", async ({ page }) => {
  const actions: string[] = [];
  await page.route("**/api/auth/*", async (route) => {
    actions.push(route.request().url().split("/").at(-1)!);
    await route.fulfill({ status: 400, json: { message: "Solo se permiten correos de instituciones habilitadas en UniFood." } });
  });
  await page.goto("/registro");
  await page.getByRole("textbox", { name: "Nombre completo" }).fill("María Pérez");
  await page.getByRole("textbox", { name: "Número de documento" }).fill("123456789");
  await page.getByRole("button", { name: "Continuar" }).click();
  for (const email of ["maria@gmail.com", "maria@ustavillavicencio.edu.co.evil.com"]) {
    await page.getByRole("textbox").fill(email);
    await page.getByRole("button", { name: "Continuar" }).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText("instituciones habilitadas");
    await expect(page.getByRole("heading", { name: "Usa tu correo institucional" })).toBeVisible();
  }
  expect(actions).toEqual(["institution", "institution"]);
});

test("password recovery goes from email and OTP to password and back to login", async ({ page }) => {
  const actions: string[] = [];
  await page.route("**/api/auth/*", async (route) => {
    actions.push(route.request().url().split("/").at(-1)!);
    await route.fulfill({ json: { ok: true } });
  });
  await page.goto("/recuperar-contrasena");
  await page.getByRole("textbox").fill("maria@ustavillavicencio.edu.co");
  await page.getByRole("button", { name: "Enviar código" }).click();
  await expect(page.getByRole("status")).toContainText("Si existe una cuenta");
  await page.getByRole("textbox", { name: "Dígito 1", exact: true }).fill("654321");
  await page.getByRole("button", { name: "Verificar", exact: true }).click();
  await page.getByLabel("Contraseña", { exact: true }).fill("NuevaClave9");
  await page.getByLabel("Confirmar contraseña", { exact: true }).fill("NuevaClave9");
  await page.getByRole("button", { name: "Restablecer contraseña" }).click();
  await expect(page.getByRole("status")).toContainText("se actualizó");
  await expect(page.getByLabel("Contraseña", { exact: true })).toHaveValue("");
  expect(actions).toEqual(["recover", "verify", "reset"]);
});

test("anonymous users cannot load the worker panel or orders", async ({ page, request }) => {
  await page.goto("/worker");
  await expect(page).toHaveURL(/\/login$/);
  expect((await request.get("/api/orders")).status()).toBe(401);
  expect((await request.post("/api/auth/login", { headers: { origin: "https://evil.example" }, data: {} })).status()).toBe(403);
});

test("desktop login stays readable and scrollable on short screens", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/login");
  // Interact first so the screenshot's caret styling cannot race hydration.
  await page.getByRole("button", { name: "Mostrar contraseña" }).click();
  await page.getByRole("button", { name: "Ocultar contraseña" }).click();
  await page.screenshot({ path: testInfo.outputPath("login-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 320, height: 568 });
  await page.getByRole("link", { name: "Registrarse como estudiante" }).scrollIntoViewIfNeeded();
  await expect(page.getByRole("link", { name: "Registrarse como estudiante" })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

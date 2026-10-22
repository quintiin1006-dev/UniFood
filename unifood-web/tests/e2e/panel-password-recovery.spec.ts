import { test, expect as baseExpect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const expect = baseExpect.configure({ timeout: 20_000 });
const provider = "http://127.0.0.1:3101";
// Recovery credentials must not enter retained request/DOM traces or failure screenshots.
// Explicit visual captures below are made only with empty password fields.
test.use({ trace: "off", screenshot: "off", video: "off" });
test.skip(
  !!process.env.PLAYWRIGHT_BASE_URL,
  "Uses the controlled local Auth provider, never real email.",
);
async function configure(page: Page, config: Record<string, unknown> = {}) {
  const response = await page.request.post(
    `${provider}/__test/panel-recovery`,
    { data: config },
  );
  expect(response.status()).toBe(200);
  return response.json();
}
async function audit(page: Page) {
  return (await page.request.get(`${provider}/__test/panel-recovery`)).json();
}
async function send(page: Page, email = "recoveryworker@example.invalid") {
  await page.goto("/panel/recuperar");
  await page
    .getByLabel("Correo electrónico", { exact: true })
    .pressSequentially(email);
  await page
    .getByRole("button", { name: "Enviar instrucciones", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Si existe una cuenta asociada",
  );
  return (await audit(page)).lastLink as string;
}
async function openRecovery(page: Page) {
  const link = await send(page);
  await page.goto(link);
  await expect(
    page.getByLabel("Nueva contraseña", { exact: true }),
  ).toBeEnabled();
  await expect(page).toHaveURL(/\/panel\/nueva-contrasena$/);
  return link;
}
async function fillPassword(
  page: Page,
  password = "NuevaClave9",
  confirmation = password,
) {
  // Real key events also exercise React's controlled state in Firefox BiDi.
  for (const [label, value] of [
    ["Nueva contraseña", password],
    ["Confirmar contraseña", confirmation],
  ]) {
    const input = page.getByLabel(label, { exact: true });
    await input.press("ControlOrMeta+A");
    await input.press("Backspace");
    await input.pressSequentially(value);
  }
}
const submit = (page: Page) =>
  page
    .getByRole("button", { name: "Actualizar contraseña", exact: true })
    .click();
test.beforeEach(async ({ page }) => {
  await configure(page, { reset: true });
});
test.afterEach(async ({ page }) => {
  await configure(page, { reset: true });
});

test("panel login links to recovery; legacy panel route safely redirects without preserving returnTo", async ({
  page,
}) => {
  await page.goto("/panel/login");
  await page.getByRole("link", { name: "¿Olvidaste tu contraseña?" }).click();
  await expect(page).toHaveURL(/\/panel\/recuperar$/);
  await expect(
    page.getByRole("heading", { name: "Recupera tu cuenta", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("textbox")).toHaveCount(1);
  await page.goto(
    "/recuperar-contrasena?entrypoint=panel&returnTo=https://foreign.invalid",
  );
  await expect(page).toHaveURL(/\/panel\/recuperar$/);
});

test("empty/invalid email is accessible and never contacts Auth", async ({
  page,
}) => {
  await page.goto("/panel/recuperar");
  await page.getByRole("button", { name: "Enviar instrucciones" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "Ingresa un correo válido.",
  );
  await expect(page.getByRole("main").getByRole("alert")).toBeFocused();
  await page
    .getByLabel("Correo electrónico", { exact: true })
    .fill("not-an-email");
  await page.getByRole("button", { name: "Enviar instrucciones" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "Ingresa un correo válido.",
  );
  expect((await audit(page)).requests).toBe(0);
});

test("unknown and existing addresses receive the same neutral UI without business queries", async ({
  page,
}) => {
  await send(page, "unknown@example.invalid");
  const neutral = await page.getByRole("status").textContent();
  expect((await audit(page)).lastLink).toBeNull();
  await send(page);
  expect(await page.getByRole("status").textContent()).toBe(neutral);
  expect((await audit(page)).businessReads).toBe(0);
  await expect(page.getByRole("main")).not.toContainText(
    /WORKER|ADMIN|cafetería asignada|usuario no existe|correo no registrado/,
  );
});

test("request loading and immediate double submit send only one request", async ({
  page,
}) => {
  await page.goto("/panel/recuperar");
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/auth/v1/recover**", async (route) => {
    await gate;
    await route.continue();
  });
  await page
    .getByLabel("Correo electrónico", { exact: true })
    .fill("recoveryworker@example.invalid");
  const waiting = page.waitForRequest(
    (request) => new URL(request.url()).pathname === "/auth/v1/recover",
  );
  await page.locator("form").evaluate((form: HTMLFormElement) => {
    form.requestSubmit();
    form.requestSubmit();
  });
  await waiting;
  await expect(
    page.getByRole("button", { name: "Procesando…" }),
  ).toBeDisabled();
  await expect(
    page.getByLabel("Correo electrónico", { exact: true }),
  ).toBeDisabled();
  release();
  await expect(page.getByRole("status")).toContainText("Si existe una cuenta");
  expect((await audit(page)).requests).toBe(1);
});

for (const status of [429, 503]) {
  test(`request ${status} is sanitized and can retry`, async ({ page }) => {
    await configure(page, { requestMode: String(status) });
    await page.goto("/panel/recuperar");
    await page
      .getByLabel("Correo electrónico", { exact: true })
      .fill("recoveryworker@example.invalid");
    await page.getByRole("button", { name: "Enviar instrucciones" }).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      status === 429
        ? "Demasiadas solicitudes"
        : "No pudimos completar la solicitud en este momento",
    );
    await expect(page.getByRole("main").getByRole("alert")).not.toContainText(
      /PRIVATE|MAIL|SQL/,
    );
    await configure(page, { requestMode: null });
    await page.getByRole("button", { name: "Enviar instrucciones" }).click();
    await expect(page.getByRole("status")).toContainText(
      "Si existe una cuenta",
    );
  });
}

test("request failure preserves an existing HttpOnly panel session", async ({
  page,
}) => {
  await page.goto("/panel/login");
  await page
    .getByLabel("Usuario o correo institucional", { exact: true })
    .fill("worker@example.invalid");
  await page.getByLabel("Contraseña", { exact: true }).fill("UnaClave8");
  const ordersLoaded = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/orders",
  );
  await page
    .getByRole("button", { name: "Iniciar sesión", exact: true })
    .click();
  await expect(page).toHaveURL(/\/worker$/);
  await (await ordersLoaded).finished();
  const cookies = async () =>
    (await page.context().cookies()).filter((cookie) =>
      cookie.name.includes("auth-token"),
    );
  await configure(page, { requestMode: "503" });
  await page.goto("/panel/recuperar");
  // The dashboard's initial business request must finish before this baseline.
  const before = JSON.stringify(await cookies());
  const reads = (await audit(page)).businessReads;
  await page
    .getByLabel("Correo electrónico", { exact: true })
    .fill("recoveryworker@example.invalid");
  await page.getByRole("button", { name: "Enviar instrucciones" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "No pudimos completar la solicitud en este momento",
  );
  expect(JSON.stringify(await cookies()) === before).toBe(true);
  expect((await audit(page)).businessReads).toBe(reads);
});

test("real SDK PKCE recovery is isolated, validates mismatch and password visibility, then returns to login", async ({
  page,
}) => {
  const consoleMessages: string[] = [];
  page.on("console", (message) => consoleMessages.push(message.text()));
  page.on("pageerror", (error) => consoleMessages.push(error.message));
  const payloadRoutes: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "PUT")
      payloadRoutes.push(new URL(request.url()).pathname);
  });
  const link = await openRecovery(page);
  expect(new URL(link).pathname).toBe("/panel/nueva-contrasena");
  expect(
    (await page.context().cookies()).some((cookie) =>
      cookie.name.includes("auth-token"),
    ),
  ).toBe(false);
  await fillPassword(page, "NuevaClave9", "OtraClave8");
  await submit(page);
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "Las contraseñas no coinciden.",
  );
  expect((await audit(page)).updates).toBe(0);
  await page
    .getByRole("button", { name: "Mostrar contraseña", exact: true })
    .first()
    .click();
  await expect(
    page.getByLabel("Nueva contraseña", { exact: true }),
  ).toHaveAttribute("type", "text");
  await page
    .getByRole("button", { name: "Ocultar contraseña", exact: true })
    .click();
  await expect(
    page.getByLabel("Nueva contraseña", { exact: true }),
  ).toHaveAttribute("type", "password");
  await fillPassword(page);
  await submit(page);
  await expect(page).toHaveURL(/\/panel\/login\?password=updated$/);
  await expect(page.getByRole("status")).toContainText(
    "Tu contraseña se actualizó correctamente",
  );
  expect(payloadRoutes).toEqual(["/auth/v1/user"]);
  expect((await audit(page)).businessReads).toBe(0);
  expect(
    (await page.context().cookies()).some(
      (cookie) =>
        cookie.name.includes("auth-token") ||
        cookie.name === "unifood-remember",
    ),
  ).toBe(false);
  expect(consoleMessages.some((value) => value.includes("NuevaClave9"))).toBe(
    false,
  );
  expect(page.url().includes("NuevaClave9")).toBe(false);
  expect(
    consoleMessages.some((value) =>
      /hydrat|didn't match|react error #418/i.test(value),
    ),
  ).toBe(false);
  const storage = await page.evaluate(() =>
    JSON.stringify(window.localStorage),
  );
  expect(
    storage.includes("access_token") || storage.includes("refresh_token"),
  ).toBe(false);
  await page.goto(link);
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "El enlace de recuperación venció o ya fue utilizado. Solicita uno nuevo.",
  );
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
});

for (const suffix of [
  "",
  "?email=recoveryworker@example.invalid&type=recovery",
  "?code=arbitrary-code-value",
  "#access_token=forged&type=recovery",
]) {
  test(`unproven recovery ${suffix ? "parameters " + suffix.slice(0, 12) : "direct visit"} never exposes an update form`, async ({
    page,
  }) => {
    await page.goto("/panel/nueva-contrasena" + suffix);
    await expect(page.getByRole("main").getByRole("alert")).toHaveText(
      "El enlace de recuperación venció o ya fue utilizado. Solicita uno nuevo.",
    );
    await expect(
      page.getByRole("link", { name: "Solicitar un nuevo enlace" }),
    ).toBeVisible();
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    expect((await audit(page)).updates).toBe(0);
  });
}

test("expired code and reload after consumption require a fresh recovery", async ({
  page,
}) => {
  const expired = await send(page);
  await configure(page, { expire: true });
  await page.goto(expired);
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "venció o ya fue utilizado",
  );
  await openRecovery(page);
  await page.reload();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "venció o ya fue utilizado",
  );
  expect((await audit(page)).updates).toBe(0);
});

for (const mode of ["503", "weak_password", "same_password"]) {
  test(`update ${mode} remains sanitized and retry uses the verified recovery`, async ({
    page,
  }) => {
    await openRecovery(page);
    await configure(page, { updateMode: mode });
    await fillPassword(page);
    await submit(page);
    await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
    await expect(page.getByRole("main").getByRole("alert")).not.toContainText(
      /PRIVATE|UPDATE|SQL/,
    );
    await expect(page).toHaveURL(/\/panel\/nueva-contrasena$/);
    await configure(page, { updateMode: null });
    await submit(page);
    await expect(page).toHaveURL(/\/panel\/login\?password=updated$/);
  });
}

test("cleanup retry does not update the password twice", async ({ page }) => {
  await openRecovery(page);
  await configure(page, { logoutMode: "503" });
  await fillPassword(page);
  await submit(page);
  await expect(page.getByRole("status")).toContainText(
    "Tu contraseña se actualizó",
  );
  await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
  expect((await audit(page)).updates).toBe(1);
  await configure(page, { logoutMode: null });
  await page.getByRole("button", { name: "Finalizar recuperación" }).click();
  await expect(page).toHaveURL(/\/panel\/login\?password=updated$/);
  expect((await audit(page)).updates).toBe(1);
});

for (const [user, destination] of [
  ["recoveryworker", "/worker"],
  ["recoveryadmin", "/admin"],
  ["recoverysuperadmin", "/super-admin"],
]) {
  test(`${user} recovers without role queries and normal login resolves ${destination}`, async ({
    page,
  }) => {
    const link = await send(page, `${user}@example.invalid`);
    await page.goto(link);
    await expect(
      page.getByLabel("Nueva contraseña", { exact: true }),
    ).toBeEnabled();
    await fillPassword(page);
    await submit(page);
    await expect(page).toHaveURL(/\/panel\/login\?password=updated$/);
    expect((await audit(page)).businessReads).toBe(0);
    await page
      .getByLabel("Usuario o correo institucional", { exact: true })
      .fill(`${user}@example.invalid`);
    await page.getByLabel("Contraseña", { exact: true }).fill("NuevaClave9");
    await page
      .getByRole("button", { name: "Iniciar sesión", exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(destination + "$"));
    await page
      .getByRole("button", { name: "Cerrar sesión", exact: true })
      .click();
    await expect(page).toHaveURL(/\/panel\/login$/);
  });
}

for (const width of [390, 768, 1366, 1920]) {
  test(`recovery visual ${width}px shares the full-bleed hero and has no overflow`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    const errors: string[] = [];
    page.on("console", (message) => {
      if (/hydrat|didn't match/i.test(message.text()))
        errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));
    const directory = join(tmpdir(), "unifood-panel-recovery-visual");
    await mkdir(directory, { recursive: true });
    await openRecovery(page);
    for (const path of [
      "/panel/nueva-contrasena",
      "/panel/recuperar",
      "/panel/login",
    ]) {
      if (path !== "/panel/nueva-contrasena") await page.goto(path);
      const hero = page.locator("aside");
      if (width >= 960) {
        await expect(hero).toBeVisible();
        const illustration = hero.locator("img");
        expect(
          await illustration.evaluate(
            (image: HTMLImageElement) =>
              image.src.includes("Topos.png") ||
              image.src.includes("Topos%2Epng"),
          ),
        ).toBe(true);
        expect(
          await illustration.evaluate(
            (image) => getComputedStyle(image).objectFit,
          ),
        ).toBe("cover");
        const bounds = await hero.boundingBox(),
          imageBounds = await illustration.boundingBox();
        expect(
          Math.abs(bounds!.width - imageBounds!.width),
        ).toBeLessThanOrEqual(2);
        expect(
          Math.abs(bounds!.height - imageBounds!.height),
        ).toBeLessThanOrEqual(2);
        expect(
          await hero.evaluate((element) => getComputedStyle(element).overflow),
        ).toBe("hidden");
      } else await expect(hero).not.toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: join(directory, `${width}-${path.split("/").pop()}.png`),
        fullPage: true,
      });
    }
    expect(errors).toEqual([]);
  });
}

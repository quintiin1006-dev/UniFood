import { expect, test, type Page } from "@playwright/test";

const provider = "http://127.0.0.1:3101";
const CLIENT = "client@example.invalid";

async function setTerms(
  page: Page,
  config: { email?: string; accepted: boolean; failing?: boolean },
) {
  expect(
    (
      await page.request.post(provider + "/__test/terms", {
        data: { email: CLIENT, ...config },
      })
    ).status(),
  ).toBe(200);
}

const origin = () => new URL(test.info().project.use.baseURL as string).origin;

async function apiLogin(page: Page, email = CLIENT) {
  const response = await page.request.post("/api/auth/login", {
    headers: { origin: origin() },
    data: { email, password: "UnaClave8", entrypoint: "client" },
  });
  expect(response.status()).toBe(200);
  return response.json();
}

/** The login form, as a person uses it. */
async function signIn(page: Page, email = CLIENT) {
  await page.goto("/login");
  await page.getByLabel("Usuario o correo institucional").fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill("UnaClave8");
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
}

const termsHeading = (page: Page) =>
  page.getByRole("heading", { name: "Antes de seguir" });
const acceptBox = (page: Page) =>
  page.getByRole("checkbox", { name: /Acepto los/ });
const acceptButton = (page: Page) =>
  page.getByRole("button", { name: "Aceptar y continuar" });

test.afterEach(async ({ page }) => {
  await setTerms(page, { accepted: true, failing: false });
});

test("signing in without the current terms stays on the login card and only then enters the home", async ({
  page,
}) => {
  await setTerms(page, { accepted: false });
  const seen: string[] = [];
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) seen.push(new URL(frame.url()).pathname);
  });
  await signIn(page);
  // The step replaces the login form in the same card: no navigation, no client screen.
  await expect(termsHeading(page)).toBeVisible();
  await expect(page).toHaveURL(new URL("/login", page.url()).href);
  await expect(page.getByLabel("Contraseña", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "términos y condiciones" }),
  ).toHaveAttribute("href", "/terminos");

  // Disabled until the box is ticked; trying anyway explains what is missing.
  await expect(acceptButton(page)).toBeDisabled();
  const hint = page.getByText("Marca la casilla para continuar.");
  await acceptBox(page).press("Enter");
  await expect(hint).toBeVisible();
  // Clicking the disabled button says the same, instead of doing nothing.
  await acceptBox(page).check();
  await acceptBox(page).uncheck();
  await expect(hint).toHaveCount(0);
  await acceptButton(page).click({ force: true });
  await expect(hint).toBeVisible();

  await acceptBox(page).check();
  await expect(acceptButton(page)).toBeEnabled();
  // Nothing of the client has been loaded up to this point.
  expect(seen.filter((path) => path.startsWith("/cuenta"))).toEqual([]);
  await acceptButton(page).click();
  await expect(page).toHaveURL(new URL("/cuenta", page.url()).href, {
    timeout: 30_000,
  });
  // A client screen, at last: the cafeteria picker or the greeting of a chosen one.
  await expect(
    page.getByRole("heading", { name: /¿Dónde vas a pedir hoy\?|^¡Hola/ }),
  ).toBeVisible({ timeout: 30_000 });
  // ...and it only appears after it.
  expect(
    seen.filter((path) => path.startsWith("/cuenta")).length,
  ).toBeGreaterThan(0);
});

test("a client who already accepted goes straight in, with no terms step", async ({
  page,
}) => {
  await setTerms(page, { accepted: true });
  await signIn(page);
  await expect(page).toHaveURL(new URL("/cuenta", page.url()).href, {
    timeout: 30_000,
  });
  await expect(termsHeading(page)).toHaveCount(0);
});

test("an open session without the terms is redirected before any client screen renders", async ({
  page,
}) => {
  await apiLogin(page);
  await setTerms(page, { accepted: false });
  // Straight to a deep client route: it must not render, and the destination is kept.
  const response = await page.goto("/cuenta/carrito");
  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL(
    /\/aceptar-terminos\?destino=%2Fcuenta%2Fcarrito/,
  );
  await expect(termsHeading(page)).toBeVisible();
  await expect(page.getByText("Tu carrito")).toHaveCount(0);
  await acceptBox(page).check();
  await acceptButton(page).click();
  // Back to where they were going, not to the home.
  await expect(page).toHaveURL(new URL("/cuenta/carrito", page.url()).href, {
    timeout: 30_000,
  });
});

test("a terms state that cannot be read never lets anyone through and offers a retry", async ({
  page,
}) => {
  await apiLogin(page);
  await setTerms(page, { accepted: true, failing: true });
  await page.goto("/cuenta");
  await expect(page).toHaveURL(/\/aceptar-terminos/);
  await expect(
    page.getByText("No pudimos verificar tu sesión en este momento."),
  ).toBeVisible();
  // Fail closed: no checkbox, no way past, only a retry.
  await expect(acceptBox(page)).toHaveCount(0);
  const retry = page.getByRole("button", { name: "Reintentar" });
  await retry.click();
  await expect(
    page.getByText("No pudimos verificar tu sesión en este momento."),
  ).toBeVisible();
  // Once the read works again, the same retry moves on.
  await setTerms(page, { accepted: true, failing: false });
  await retry.click();
  await expect(page).toHaveURL(new URL("/cuenta", page.url()).href, {
    timeout: 30_000,
  });
});

test("the terms step never appears for a worker or an admin", async ({
  page,
}) => {
  await setTerms(page, { accepted: false });
  for (const [email, path] of [
    ["worker@example.invalid", "/worker"],
    ["admin@example.invalid", "/admin"],
  ]) {
    const response = await page.request.post("/api/auth/login", {
      headers: { origin: origin() },
      data: { email, password: "UnaClave8", entrypoint: "panel" },
    });
    expect(response.status()).toBe(200);
    expect((await response.json()).terms).toBeUndefined();
    await page.goto(path);
    await expect(page).toHaveURL(new URL(path, page.url()).href);
    await expect(termsHeading(page)).toHaveCount(0);
    await page.request.post("/api/auth/logout", {
      headers: { origin: origin() },
      data: { entrypoint: "panel" },
    });
  }
});

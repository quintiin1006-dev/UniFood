import { test, expect, type Page } from "@playwright/test";

test.skip(
  !!process.env.PLAYWRIGHT_BASE_URL,
  "Requires the isolated local auth provider",
);

async function submitLogin(
  page: Page,
  path: string,
  name: string,
  password = "UnaClave8",
) {
  await page.goto(path);
  await page
    .getByLabel("Usuario o correo institucional", { exact: true })
    .fill(name + "@example.invalid");
  await page.getByLabel("Contraseña", { exact: true }).fill(password);
  const response = page.waitForResponse("**/api/auth/login");
  await page
    .getByRole("button", { name: "Iniciar sesión", exact: true })
    .click();
  return response;
}

for (const [name, path] of [
  ["client", "/panel/login"],
  ["worker", "/login"],
  ["admin", "/login"],
  ["superadmin", "/login"],
]) {
  test(`${name} is rejected through the other login UI without retaining a session`, async ({
    page,
  }) => {
    const response = await submitLogin(page, path, name);
    expect(response.status()).toBe(403);
    await expect(page.getByRole("main").getByRole("alert")).toHaveText(
      "Tu cuenta no tiene acceso desde esta entrada. Usa el acceso correspondiente.",
    );
    await expect(page).toHaveURL(new URL(path, page.url()).href);
    expect((await page.context().cookies()).length).toBe(0);
    expect((await page.request.get("/api/orders")).status()).toBe(401);
    await page.reload();
    await expect(page).toHaveURL(new URL(path, page.url()).href);
  });
}

for (const [name, path] of [
  ["client", "/login"],
  ["worker", "/panel/login"],
]) {
  test(`${name} sees a safe error from the real BFF for incorrect credentials`, async ({
    page,
  }) => {
    const response = await submitLogin(page, path, name, "IncorrectSynthetic8");
    expect(response.status()).toBe(401);
    expect(response.request().method()).toBe("POST");
    await expect(page.getByRole("main").getByRole("alert")).toHaveText(
      "El usuario o la contraseña no son correctos.",
    );
    await expect(page).toHaveURL(new URL(path, page.url()).href);
    expect((await page.context().cookies()).length).toBe(0);
  });
}

for (const name of ["providerdown", "providerdisconnect"]) {
  test(`${name} produces a safe service error and lets the user retry`, async ({
    page,
  }) => {
    const response = await submitLogin(page, "/login", name);
    expect(response.status()).toBe(502);
    await expect(page.getByRole("main").getByRole("alert")).toHaveText(
      "No pudimos completar la solicitud. Revisa los datos o vuelve a intentarlo.",
    );
    await expect(
      page.getByRole("button", { name: "Iniciar sesión", exact: true }),
    ).toBeEnabled();
    expect((await page.context().cookies()).length).toBe(0);
    expect(new URL(page.url()).search).toBe("");
  });
}

test("unconfirmed CLIENT completes OTP admission without credentials in navigation URLs", async ({
  page,
}) => {
  const urls: string[] = [];
  page.on("request", (request) => {
    if (request.isNavigationRequest()) urls.push(request.url());
  });
  expect((await submitLogin(page, "/login", "unverifiedclient")).status()).toBe(
    403,
  );
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Verifica tu correo",
  );
  expect((await page.context().cookies()).length).toBe(0);
  await page
    .getByRole("button", { name: "Verificar mi correo", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Dígito 1", exact: true })
    .fill("123456");
  await page.getByRole("button", { name: "Verificar", exact: true }).click();
  await expect(page).toHaveURL(new URL("/cuenta", page.url()).href);
  for (const url of urls) expect(new URL(url).search).toBe("");
});

test("all four anonymous protected routes redirect to their exact entrypoint", async ({
  page,
}) => {
  for (const [path, login] of [
    ["/cuenta", "/login"],
    ["/worker", "/panel/login"],
    ["/admin", "/panel/login"],
    ["/super-admin", "/panel/login"],
  ]) {
    await page.goto(path);
    await expect(page).toHaveURL(new URL(login, page.url()).href);
  }
});

for (const [name, login, destination] of [
  ["client", "/login", "/cuenta"],
  ["worker", "/panel/login", "/worker"],
]) {
  test(`${name} loses access on refresh after session cookies disappear`, async ({
    page,
  }) => {
    expect((await submitLogin(page, login, name)).status()).toBe(200);
    await expect(page).toHaveURL(new URL(destination, page.url()).href);
    await page.context().clearCookies();
    await page.reload();
    await expect(page).toHaveURL(new URL(login, page.url()).href);
    expect((await page.request.get("/api/orders")).status()).toBe(401);
  });
}

async function expireSession(page: Page, invalidRefresh = false) {
  const cookies = (await page.context().cookies()).filter(({ name }) =>
    name.startsWith("sb-"),
  );
  expect(cookies.length).toBe(1); // These short synthetic sessions fit in one SDK cookie.
  const cookie = cookies[0];
  const session = JSON.parse(
    Buffer.from(cookie.value.slice("base64-".length), "base64url").toString(),
  );
  const parts = session.access_token.split(".");
  const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString());
  claims.exp = Math.floor(Date.now() / 1000) - 60;
  parts[1] = Buffer.from(JSON.stringify(claims)).toString("base64url");
  session.access_token = parts.join(".");
  session.expires_at = claims.exp;
  if (invalidRefresh) session.refresh_token = "invalid-synthetic-refresh";
  await page
    .context()
    .addCookies([
      {
        ...cookie,
        value:
          "base64-" +
          Buffer.from(JSON.stringify(session)).toString("base64url"),
      },
    ]);
}

for (const [name, login, destination, remember] of [
  ["client", "/login", "/cuenta", true],
  ["worker", "/panel/login", "/worker", false],
] as const) {
  test(`${name} refreshes an expired session while preserving its cookie persistence policy`, async ({
    page,
  }) => {
    await page.goto(login);
    await page.getByRole("checkbox").setChecked(remember);
    await page
      .getByLabel("Usuario o correo institucional", { exact: true })
      .fill(name + "@example.invalid");
    await page.getByLabel("Contraseña", { exact: true }).fill("UnaClave8");
    await page
      .getByRole("button", { name: "Iniciar sesión", exact: true })
      .click();
    await expect(page).toHaveURL(new URL(destination, page.url()).href);
    await expireSession(page);
    await page.reload();
    await expect(page).toHaveURL(new URL(destination, page.url()).href);
    const cookies = (await page.context().cookies()).filter(({ name }) =>
      name.startsWith("sb-"),
    );
    expect(cookies.length).toBeGreaterThan(0);
    for (const cookie of cookies) {
      const session = JSON.parse(
        Buffer.from(cookie.value.slice(7), "base64url").toString(),
      );
      expect(session.expires_at > Date.now() / 1000).toBe(true);
      expect(cookie.httpOnly).toBe(true);
      expect(
        remember ? cookie.expires > Date.now() / 1000 : cookie.expires === -1,
      ).toBe(true);
    }
    expect(new URL(page.url()).search).toBe("");
  });
}

test("an expired worker session with a rejected refresh returns to panel login", async ({
  page,
}) => {
  expect((await submitLogin(page, "/panel/login", "worker")).status()).toBe(
    200,
  );
  await expect(page).toHaveURL(new URL("/worker", page.url()).href);
  await expireSession(page, true);
  await page.reload();
  await expect(page).toHaveURL(new URL("/panel/login", page.url()).href);
  expect(
    (await page.context().cookies()).filter(({ name }) =>
      name.startsWith("sb-"),
    ).length,
  ).toBe(0);
  expect((await page.request.get("/api/orders")).status()).toBe(401);
});

for (const [name, status] of [
  ["backendunauthorized", 401],
  ["backendforbidden", 403],
  ["backendunavailable", 502],
  ["backenddisconnect", 502],
] as const) {
  test(`${name} exposes a safe operational error without enabling order actions`, async ({
    page,
  }) => {
    await page.goto("/panel/login");
    const ordersResponse = page.waitForResponse("**/api/orders");
    await page
      .getByLabel("Usuario o correo institucional", { exact: true })
      .fill(name + "@example.invalid");
    await page.getByLabel("Contraseña", { exact: true }).fill("UnaClave8");
    await page
      .getByRole("button", { name: "Iniciar sesión", exact: true })
      .click();
    await expect(page).toHaveURL(new URL("/worker", page.url()).href);
    const response = await ordersResponse;
    expect(response.status()).toBe(status);
    expect((await response.text()).includes("PRIVATE_FIXTURE_DETAIL")).toBe(
      false,
    );
    await expect(
      page.getByText(
        name === "backenddisconnect"
          ? "No se pudo conectar con el backend de pedidos. Revisa que esté disponible."
          : "No se pudo resolver la cafetería de tu cuenta.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Pasar a preparación", exact: true }),
    ).toHaveCount(0);
  });
}

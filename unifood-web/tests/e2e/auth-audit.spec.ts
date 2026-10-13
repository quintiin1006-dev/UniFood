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
  await page.context().addCookies([
    {
      ...cookie,
      value:
        "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url"),
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

for (const [name, login, destination, api] of [
  ["worker", "/panel/login", "/worker", "/api/orders"],
  [
    "client",
    "/login",
    "/cuenta",
    "/api/me/orders/00000000-0000-0000-0000-000000000001/cancel",
  ],
] as const) {
  test(`an expired ${name} session with a rejected refresh erases cookies and supports a subsequent login`, async ({
    page,
  }) => {
    expect((await submitLogin(page, login, name)).status()).toBe(200);
    await expect(page).toHaveURL(new URL(destination, page.url()).href);
    await expireSession(page, true);
    // Exercise competing navigation/API requests with the same rejected refresh.
    const denied =
      name === "worker"
        ? page.request.get(api)
        : page.request.patch(api, {
            headers: { origin: new URL(page.url()).origin },
          });
    await page.reload();
    await expect(page).toHaveURL(new URL(login, page.url()).href);
    expect(
      (await page.context().cookies()).filter(({ name }) =>
        name.startsWith("sb-"),
      ).length,
    ).toBe(0);
    expect((await denied).status()).toBe(401);
    await page.reload();
    await expect(page).toHaveURL(new URL(login, page.url()).href);
    expect((await submitLogin(page, login, name)).status()).toBe(200);
    await expect(page).toHaveURL(new URL(destination, page.url()).href);
  });
}

async function providerFailure(page: Page, name: string, mode: string | null) {
  const response = await page.request.post(
    "http://127.0.0.1:3101/__test/auth-failure",
    { data: { email: `${name}@example.invalid`, mode } },
  );
  expect(response.status()).toBe(200);
}

for (const [name, login, destination, api] of [
  ["worker", "/panel/login", "/worker", "/api/orders"],
  [
    "client",
    "/login",
    "/cuenta",
    "/api/me/orders/00000000-0000-0000-0000-000000000010/cancel",
  ],
] as const) {
  for (const mode of ["503", "disconnect"] as const) {
    test(`${name} preserves an expired session during retryable ${mode} and recovers without login`, async ({
      page,
    }) => {
      // The real SDK keeps its production retry/backoff window; no sleep is used as evidence.
      test.setTimeout(90_000);
      expect((await submitLogin(page, login, name)).status()).toBe(200);
      await expect(page).toHaveURL(new URL(destination, page.url()).href);
      await expireSession(page);
      const before = await page.context().cookies();
      await providerFailure(page, name, mode);
      try {
        const denied =
          name === "worker"
            ? page.request.get(api, { timeout: 60_000 })
            : page.request.patch(api, {
                timeout: 60_000,
                headers: { origin: new URL(page.url()).origin },
              });
        const navigation = await page.reload({ timeout: 60_000 });
        expect(navigation?.status()).toBe(503);
        await expect(page).toHaveURL(new URL(destination, page.url()).href);
        await expect(page.getByRole("main").getByRole("alert")).toHaveText(
          "No pudimos verificar tu sesión en este momento. Inténtalo nuevamente.",
        );
        expect(await page.content()).not.toContain("PRIVATE_PROVIDER_OUTAGE");
        const apiResponse = await denied;
        expect(apiResponse.status()).toBe(503);
        expect(apiResponse.headers()["cache-control"]).toBe("no-store");
        expect(apiResponse.headers()["set-cookie"]).toBeUndefined();
        expect((await apiResponse.json()).code).toBe(
          "AUTH_TEMPORARILY_UNAVAILABLE",
        );
        expect(await page.context().cookies()).toEqual(before);
      } finally {
        await providerFailure(page, name, null);
      }
      await page.getByRole("link", { name: "Volver a intentar" }).click();
      await expect(page).toHaveURL(new URL(destination, page.url()).href);
      await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
      expect(
        (await page.context().cookies()).some(({ name }) =>
          name.startsWith("sb-"),
        ),
      ).toBe(true);
      const recovered =
        name === "worker"
          ? await page.request.get(api)
          : await page.request.patch(api, {
              headers: { origin: new URL(page.url()).origin },
            });
      expect(recovered.status()).toBe(200);
      await page.reload();
      await expect(page).toHaveURL(new URL(destination, page.url()).href);
    });
  }

  test(`${name} preserves its session if profile verification fails after proxy and retries safely`, async ({
    page,
  }) => {
    expect((await submitLogin(page, login, name)).status()).toBe(200);
    await expect(page).toHaveURL(new URL(destination, page.url()).href);
    const before = await page.context().cookies();
    await providerFailure(page, name, "profile");
    try {
      await page.reload();
      await expect(page.getByRole("main").getByRole("alert")).toHaveText(
        "No pudimos cargar esta página. Inténtalo nuevamente.",
      );
      await expect(page).toHaveURL(new URL(destination, page.url()).href);
      expect(await page.content()).not.toContain("PRIVATE_PROVIDER_OUTAGE");
      expect(await page.context().cookies()).toEqual(before);
      const denied =
        name === "worker"
          ? await page.request.get(api)
          : await page.request.patch(api, {
              headers: { origin: new URL(page.url()).origin },
            });
      expect(denied.status()).toBe(503);
      expect((await denied.json()).code).toBe("AUTH_TEMPORARILY_UNAVAILABLE");
    } finally {
      await providerFailure(page, name, null);
    }
    await page.getByRole("button", { name: "Volver a intentar" }).click();
    await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
    await expect(page).toHaveURL(new URL(destination, page.url()).href);
  });
}

test("CLIENT concurrency 409 keeps its actionable sanitized contract through the real BFF", async ({
  page,
}) => {
  expect((await submitLogin(page, "/login", "client")).status()).toBe(200);
  await expect(page).toHaveURL(new URL("/cuenta", page.url()).href);
  await providerFailure(page, "client", "concurrent");
  try {
    const response = await page.request.patch(
      "/api/me/orders/00000000-0000-0000-0000-000000000010/cancel",
      { headers: { origin: new URL(page.url()).origin } },
    );
    expect(response.status()).toBe(409);
    expect(response.headers()["cache-control"]).toBe("no-store");
    expect(response.headers()["set-cookie"]).toBeUndefined();
    const body = await response.json();
    expect(body.code).toBe("ORDER_CONCURRENT_MODIFICATION");
    expect(body.message).toBe(
      "La orden cambió mientras intentábamos cancelarla. Actualiza e inténtalo de nuevo.",
    );
    expect(JSON.stringify(body)).not.toContain("PRIVATE");
    expect(body.version).toBeUndefined();
  } finally {
    await providerFailure(page, "client", null);
  }
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

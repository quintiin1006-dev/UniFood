import { test, expect } from "@playwright/test";

for (const [entrypoint, path] of [
  ["panel", "/panel/login"],
  ["client", "/login"],
] as const) {
  test(`${entrypoint} hydrates and handles login on IPv4 and IPv6 loopback hosts`, async ({
    page,
    baseURL,
  }) => {
    const errors: string[] = [];
    const blockedScripts: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("response", (response) => {
      if (
        response.request().resourceType() === "script" &&
        response.status() >= 400
      )
        blockedScripts.push(response.url());
    });
    const requests: { method: string; body: unknown }[] = [];
    await page.route("**/api/auth/login", async (route) => {
      requests.push({
        method: route.request().method(),
        body: route.request().postDataJSON(),
      });
      await route.fulfill({
        status: 401,
        json: { message: "Error de prueba" },
      });
    });
    for (const host of ["127.0.0.1", "[::1]"]) {
      const url = new URL(path, baseURL);
      url.hostname = host;
      await page.goto(url.href);
      const identifier = page.locator('input[name="username"]');
      const password = page.locator('input[name="password"]');
      await identifier.fill("loopback@example.invalid");
      await password.fill("SyntheticPassword8");
      const previousRequests = requests.length;
      await page
        .getByRole("button", { name: "Mostrar contraseña", exact: true })
        .click();
      await expect(password).toHaveAttribute("type", "text");
      await page
        .getByRole("button", { name: "Ocultar contraseña", exact: true })
        .click();
      await expect(password).toHaveAttribute("type", "password");
      expect(requests).toHaveLength(previousRequests);
      await page
        .getByRole("button", { name: "Iniciar sesión", exact: true })
        .click();
      await expect(page.getByRole("main").getByRole("alert")).toHaveText(
        "Error de prueba",
      );
      expect(requests.at(-1)).toEqual({
        method: "POST",
        body: {
          email: "loopback@example.invalid",
          password: "SyntheticPassword8",
          remember: true,
          entrypoint,
        },
      });
      await expect(page).toHaveURL(url.href);
    }
    expect(errors).toEqual([]);
    expect(blockedScripts).toEqual([]);
  });

  test(`${entrypoint} intercepts click and Enter submits; the eye only toggles visibility`, async ({
    page,
  }) => {
    const errors: string[] = [];
    const navigations: string[] = [];
    const requests: { method: string; url: string; body: unknown }[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      if (request.isNavigationRequest() && request.frame() === page.mainFrame())
        navigations.push(request.url());
    });
    await page.route("**/api/auth/login", async (route) => {
      const request = route.request();
      requests.push({
        method: request.method(),
        url: request.url(),
        body: request.postDataJSON(),
      });
      await route.fulfill({
        status: 401,
        json: { message: "Credenciales de prueba rechazadas." },
      });
    });
    await page.goto(path);
    const identifier = page.getByLabel("Usuario o correo institucional", {
      exact: true,
    });
    const password = page.getByLabel("Contraseña", { exact: true });
    const submit = page.getByRole("button", {
      name: "Iniciar sesión",
      exact: true,
    });
    await identifier.fill("interaction@example.invalid");
    await password.fill("SyntheticPassword8");

    for (let i = 0; i < 3; i++) {
      const show = page.getByRole("button", {
        name: "Mostrar contraseña",
        exact: true,
      });
      await expect(show).toHaveAttribute("type", "button");
      await show.click();
      await expect(password).toHaveAttribute("type", "text");
      const hide = page.getByRole("button", {
        name: "Ocultar contraseña",
        exact: true,
      });
      await expect(hide).toHaveAttribute("aria-pressed", "true");
      await hide.click();
      await expect(password).toHaveAttribute("type", "password");
      await expect(password).toHaveValue("SyntheticPassword8");
    }
    expect(requests).toEqual([]);
    expect(navigations).toEqual([new URL(path, page.url()).href]);

    await submit.click();
    await expect(page.getByRole("main").getByRole("alert")).toHaveText(
      "Credenciales de prueba rechazadas.",
    );
    await expect(submit).toBeEnabled();
    await password.press("Enter");
    await expect.poll(() => requests.length).toBe(2);
    await expect(submit).toBeEnabled();
    expect(requests).toEqual(
      Array(2).fill({
        method: "POST",
        url: new URL("/api/auth/login", page.url()).href,
        body: {
          email: "interaction@example.invalid",
          password: "SyntheticPassword8",
          remember: true,
          entrypoint,
        },
      }),
    );
    await expect(page).toHaveURL(new URL(path, page.url()).href);
    expect(navigations).toHaveLength(1);
    expect(errors).toEqual([]);
    for (const url of [
      ...navigations,
      ...requests.map((request) => request.url),
    ]) {
      expect(new URL(url).search).toBe("");
      expect(url).not.toContain("SyntheticPassword8");
      expect(url).not.toContain("interaction");
    }
  });

  test(`${entrypoint} waits for hydration before enabling credentials, submit and the eye`, async ({
    page,
  }) => {
    const hydrationErrors: string[] = [];
    page.on("console", (message) => {
      if (
        (message.type() === "error" || message.type() === "warning") &&
        /hydration|hydrated|didn't match|react error #418/i.test(message.text())
      )
        hydrationErrors.push(message.text());
    });
    page.on("pageerror", (error) => hydrationErrors.push(error.message));
    let scriptsReady: Promise<void>;
    await page.route("**/_next/**/*.js*", async (route) => {
      await scriptsReady;
      await route.continue();
    });
    for (let round = 0; round < (entrypoint === "panel" ? 3 : 1); round++) {
      let releaseScripts!: () => void;
      scriptsReady = new Promise<void>((resolve) => {
        releaseScripts = resolve;
      });
      const navigation =
        round === 0
          ? page.goto(path, { waitUntil: "load" })
          : page.reload({ waitUntil: "load" });
      try {
        const identifier = page.locator('input[name="username"]');
        const password = page.locator('input[name="password"]');
        await expect(identifier).toBeVisible();
        await expect(identifier).toBeDisabled();
        await expect(password).toBeDisabled();
        await expect(page.getByRole("checkbox")).toBeDisabled();
        await expect(
          page.getByRole("button", { name: "Mostrar contraseña", exact: true }),
        ).toBeDisabled();
        await expect(
          page.getByRole("button", { name: "Iniciar sesión", exact: true }),
        ).toBeDisabled();
        await expect(page.locator("form")).toHaveAttribute("method", "post");
        if (entrypoint === "panel")
          await expect(page.locator("form")).toHaveAttribute(
            "autocomplete",
            "off",
          );
        expect(new URL(page.url()).search).toBe("");
      } finally {
        releaseScripts();
        await navigation;
      }
      await expect(page.locator('input[name="username"]')).toBeEnabled();
      await expect(
        page.getByRole("button", { name: "Iniciar sesión", exact: true }),
      ).toBeEnabled();
    }
    const password = page.locator('input[name="password"]');
    await password.fill("SyntheticPassword8");
    await page
      .getByRole("button", { name: "Mostrar contraseña", exact: true })
      .click();
    await expect(password).toHaveAttribute("type", "text");
    await page
      .getByRole("button", { name: "Ocultar contraseña", exact: true })
      .click();
    await expect(password).toHaveAttribute("type", "password");
    expect(hydrationErrors).toEqual([]);
  });

  test(`${entrypoint} keeps pending controls disabled, blocks duplicate submit and preserves remember choice`, async ({
    page,
  }) => {
    let releaseResponse!: () => void;
    const pending = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });
    const requests: unknown[] = [];
    await page.route("**/api/auth/login", async (route) => {
      requests.push(route.request().postDataJSON());
      await pending;
      await route.fulfill({
        status: 401,
        json: { message: "Error de prueba" },
      });
    });
    await page.goto(path);
    await page
      .locator('input[name="username"]')
      .fill("pending@example.invalid");
    await page.locator('input[name="password"]').fill("SyntheticPassword8");
    await page.getByRole("checkbox").uncheck();
    try {
      await page
        .getByRole("button", { name: "Iniciar sesión", exact: true })
        .click();
      await expect(page.locator("form")).toHaveAttribute("aria-busy", "true");
      await expect(page.locator('input[name="username"]')).toBeDisabled();
      await expect(page.locator('input[name="password"]')).toBeDisabled();
      await expect(page.getByRole("checkbox")).toBeDisabled();
      await expect(
        page.getByRole("button", { name: "Mostrar contraseña", exact: true }),
      ).toBeDisabled();
      await expect.poll(() => requests.length).toBe(1);
      await page.locator("form").evaluate((form) => {
        form.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
      });
      expect(requests).toEqual([
        {
          email: "pending@example.invalid",
          password: "SyntheticPassword8",
          remember: false,
          entrypoint,
        },
      ]);
    } finally {
      releaseResponse();
    }
    await expect(page.getByRole("main").getByRole("alert")).toHaveText(
      "Error de prueba",
    );
    await expect(page.locator('input[name="password"]')).toBeEnabled();
    await expect(page.getByRole("checkbox")).not.toBeChecked();
    await expect(page.locator("form")).toHaveAttribute("aria-busy", "false");
  });

  test(`${entrypoint} cannot expose credentials in a native GET when JavaScript is unavailable`, async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({
      javaScriptEnabled: false,
      baseURL,
    });
    try {
      const page = await context.newPage();
      await page.goto(path);
      await expect(page.locator('input[name="username"]')).toBeDisabled();
      await expect(page.locator('input[name="password"]')).toBeDisabled();
      await expect(
        page.getByRole("button", { name: "Mostrar contraseña", exact: true }),
      ).toBeDisabled();
      await expect(page.locator('button[type="submit"]')).toBeDisabled();
      // Even a forced native submit uses POST and leaves credentials out of the URL.
      const nativeRequest = page.waitForRequest(
        (request) =>
          request.isNavigationRequest() && request.method() === "POST",
      );
      await page.evaluate(() => {
        for (const [name, value] of [
          ["username", "native@example.invalid"],
          ["password", "SyntheticPassword8"],
        ]) {
          const input = document.querySelector<HTMLInputElement>(
            `input[name="${name}"]`,
          )!;
          input.disabled = false;
          input.value = value;
        }
        document.querySelector<HTMLFormElement>("form")!.submit();
      });
      const request = await nativeRequest;
      expect(request.url()).toBe(new URL(path, baseURL).href);
      expect(request.postData()).toContain("password=SyntheticPassword8");
      await page.waitForLoadState("domcontentloaded");
      expect(new URL(page.url()).search).toBe("");
      expect(page.url()).not.toContain("SyntheticPassword8");
    } finally {
      await context.close();
    }
  });
}

import { test, expect } from "@playwright/test";

test("mobile login: password visibility, remember, language and responsive layout", async ({
  page,
}, testInfo) => {
  await page.goto("/login");
  await expect(
    page.getByRole("heading", { name: "Tu comida, sin filas" }),
  ).toBeVisible();
  const password = page.getByLabel("Contraseña", { exact: true });
  await password.fill("ClaveSegura8");
  await page.getByRole("button", { name: "Mostrar contraseña" }).click();
  await expect(password).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "Ocultar contraseña" }).click();
  await expect(password).toHaveAttribute("type", "password");
  await page.getByRole("checkbox").uncheck();
  await expect(page.getByRole("checkbox")).not.toBeChecked();
  await page.getByRole("combobox").selectOption("en");
  await expect(
    page.getByRole("heading", { name: "Your food, no waiting" }),
  ).toBeVisible();
  await page.getByRole("combobox").selectOption("es");
  await password.clear();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("login-mobile.png"),
    fullPage: true,
  });
});

for (const [domain, clientType, hint] of [
  ["ustavillavo.edu.co", "STUDENT", "cuenta de estudiante"],
  ["ustavillavicencio.edu.co", "STAFF", "cuenta de docente o administrativo"],
] as const) {
  test(`step 1 asks only for the email, shows its account type and verifies the OTP for ${domain}`, async ({
    page,
  }, testInfo) => {
    const requests: { action: string; body: Record<string, unknown> }[] = [];
    await page.route("**/api/auth/*", async (route) => {
      const action = route.request().url().split("/").at(-1)!;
      requests.push({ action, body: route.request().postDataJSON() });
      if (action === "rules")
        return route.fulfill({ json: { allowed: true, clientType } });
      if (action === "verify")
        return route.fulfill({
          status: 400,
          json: {
            message: "El código no es válido o ya venció. Solicita uno nuevo.",
          },
        });
      await route.fulfill({ json: { ok: true } });
    });
    await page.goto("/registro");
    await expect(
      page.getByRole("heading", { name: "Usa tu correo institucional" }),
    ).toBeVisible();
    // Step 1 has no name, document or password fields.
    await expect(page.getByRole("textbox")).toHaveCount(1);
    await expect(page.getByLabel("Contraseña", { exact: true })).toHaveCount(0);
    await page.getByRole("textbox").fill(`maria@${domain}`);
    await expect(page.getByText(hint)).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("register-email.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "Continuar" }).click();
    await expect(
      page.getByRole("heading", { name: "Verifica tu correo" }),
    ).toBeVisible();
    await expect(
      page.getByText(`maria@${domain}`, { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("El código vence en 15 minutos."),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Reenviar código/ }),
    ).toBeDisabled();
    await page
      .getByRole("textbox", { name: "Código de verificación", exact: true })
      .fill("123456");
    await expect(
      page.getByRole("textbox", {
        name: "Código de verificación",
        exact: true,
      }),
    ).toHaveValue("123456");
    await page.screenshot({
      path: testInfo.outputPath("register-verify.png"),
      fullPage: true,
    });
    // The sixth digit submits on its own; no click is needed.
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      "no es válido",
    );
    const actions = requests.map(({ action }) => action);
    expect(actions.filter((action) => action !== "rules")).toEqual([
      "register",
      "verify",
    ]);
    const register = requests.find(({ action }) => action === "register")!.body;
    // The browser sends no password, name or code in step 1.
    expect(Object.keys(register).sort()).toEqual(["email", "entrypoint"]);
    expect(requests.at(-1)?.body.code).toBe("123456");
    expect(requests.every(({ body }) => body.email === `maria@${domain}`)).toBe(
      true,
    );
  });
}

test("step 1 rejects addresses outside the rule before signing up", async ({
  page,
}) => {
  const actions: string[] = [];
  await page.route("**/api/auth/*", async (route) => {
    const action = route.request().url().split("/").at(-1)!;
    actions.push(action);
    if (action === "rules") return route.fulfill({ json: { allowed: false } });
    await route.fulfill({
      status: 400,
      json: {
        message:
          "Solo se permiten correos institucionales habilitados en UniFood.",
        code: "REGISTRATION_DOMAIN_NOT_ALLOWED",
      },
    });
  });
  await page.goto("/registro");
  // A "+" never reaches the server.
  await page.getByRole("textbox").fill("maria+alias@ustavillavo.edu.co");
  await expect(page.getByText("sin «+»")).toBeVisible();
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "sin «+»",
  );
  for (const email of [
    "maria@gmail.com",
    "maria@ustavillavicencio.edu.co.evil.com",
  ]) {
    await page.getByRole("textbox").fill(email);
    await expect(
      page.getByRole("main").getByText("Este correo no está habilitado"),
    ).toBeVisible();
    await page.getByRole("button", { name: "Continuar" }).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      "institucionales habilitados",
    );
    await expect(
      page.getByRole("heading", { name: "Usa tu correo institucional" }),
    ).toBeVisible();
  }
  expect(actions.filter((action) => action !== "rules")).toEqual([
    "register",
    "register",
  ]);
});

test("resending the code waits between requests and stops after the limit", async ({
  page,
}) => {
  await page.clock.install();
  const actions: string[] = [];
  await page.route("**/api/auth/*", async (route) => {
    const action = route.request().url().split("/").at(-1)!;
    actions.push(action);
    if (action === "rules")
      return route.fulfill({ json: { allowed: true, clientType: "STUDENT" } });
    await route.fulfill({ json: { ok: true } });
  });
  await page.goto("/registro");
  await page.getByRole("textbox").fill("maria@ustavillavo.edu.co");
  await page.getByRole("button", { name: "Continuar" }).click();
  const resend = page.getByRole("button", { name: /Reenviar código/ });
  for (let attempt = 0; attempt < 3; attempt++) {
    await expect(resend).toBeDisabled();
    await expect(resend).toContainText("(01:00)");
    await page.clock.fastForward(61_000);
    await expect(resend).toBeEnabled();
    await resend.click();
    await expect(page.getByRole("status")).toContainText(
      "Enviamos un nuevo código",
    );
  }
  await page.clock.fastForward(61_000);
  await expect(resend).toBeDisabled();
  await expect(page.getByText("Ya pediste varios códigos")).toBeVisible();
  expect(actions.filter((action) => action === "resend")).toHaveLength(3);
});

test("a rate-limited resend shows a clear message", async ({ page }) => {
  await page.clock.install();
  await page.route("**/api/auth/*", async (route) => {
    const action = route.request().url().split("/").at(-1)!;
    if (action === "rules")
      return route.fulfill({ json: { allowed: true, clientType: "STUDENT" } });
    if (action === "resend")
      return route.fulfill({
        status: 429,
        json: {
          message:
            "Demasiados intentos. Espera un momento y vuelve a intentarlo.",
        },
      });
    await route.fulfill({ json: { ok: true } });
  });
  await page.goto("/registro");
  await page.getByRole("textbox").fill("maria@ustavillavo.edu.co");
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.clock.fastForward(61_000);
  await page.getByRole("button", { name: /Reenviar código/ }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Demasiados intentos",
  );
});

test("the code field suits mobile: attributes, focus, paste, digits only and one submit", async ({
  page,
}) => {
  const verifies: string[] = [];
  await page.route("**/api/auth/*", async (route) => {
    const action = route.request().url().split("/").at(-1)!;
    if (action === "rules")
      return route.fulfill({ json: { allowed: true, clientType: "STUDENT" } });
    if (action === "verify") {
      verifies.push(route.request().postDataJSON().code);
      // Slow answer: a second submit would arrive while this one is in flight.
      await new Promise((resolve) => setTimeout(resolve, 400));
      return route.fulfill({
        status: 400,
        json: {
          message: "El código no es válido o ya venció. Solicita uno nuevo.",
        },
      });
    }
    await route.fulfill({ json: { ok: true } });
  });
  await page.goto("/registro");
  await page.getByRole("textbox").fill("maria@ustavillavo.edu.co");
  await page.getByRole("button", { name: "Continuar" }).click();

  const field = page.getByRole("textbox", {
    name: "Código de verificación",
    exact: true,
  });
  // One labelled field, focused when the screen appears.
  await expect(field).toBeFocused();
  await expect(page.getByRole("textbox")).toHaveCount(1);
  await expect(field).toHaveAttribute("autocomplete", "one-time-code");
  await expect(field).toHaveAttribute("inputmode", "numeric");
  await expect(field).toHaveAttribute("pattern", "[0-9]{6}");
  await expect(field).toHaveAttribute("name", "one-time-code");

  // Only digits are kept while typing.
  await field.pressSequentially("1a2-3 ");
  await expect(field).toHaveValue("123");
  expect(verifies).toEqual([]);
  await field.fill("");

  // A pasted code with spaces or dashes fills the field and submits once.
  const paste = (text: string) =>
    field.evaluate((input, value) => {
      const data = new DataTransfer();
      data.setData("text/plain", value);
      input.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
        }),
      );
    }, text);
  await paste("123 - 456");
  await expect(field).toHaveValue("123456");
  // Enter while the first request is still in flight sends nothing more.
  await field.press("Enter");
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "no es válido",
  );
  expect(verifies).toEqual(["123456"]);
  // The error is announced and tied to the field, which is selected for a retry.
  await expect(page.getByRole("main").getByRole("alert")).toHaveAttribute(
    "aria-live",
    "assertive",
  );
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await expect(field).toHaveAttribute("aria-describedby", "auth-error");
  await expect(field).toBeFocused();

  // The same code is not resent on its own; a different one is.
  await paste("Tu código UniFood: 654-321");
  await expect(field).toHaveValue("654321");
  await expect.poll(() => verifies).toEqual(["123456", "654321"]);
});

test("password recovery goes from email and OTP to password and back to login", async ({
  page,
}) => {
  const actions: string[] = [];
  await page.route("**/api/auth/*", async (route) => {
    actions.push(route.request().url().split("/").at(-1)!);
    await route.fulfill({ json: { ok: true } });
  });
  await page.goto("/recuperar-contrasena");
  await page.getByRole("textbox").fill("maria@ustavillavicencio.edu.co");
  await page.getByRole("button", { name: "Enviar código" }).click();
  await expect(page.getByRole("status")).toContainText("Si existe una cuenta");
  await page
    .getByRole("textbox", { name: "Código de verificación", exact: true })
    .fill("654321");
  await page.getByLabel("Contraseña", { exact: true }).fill("NuevaClave9");
  await page
    .getByLabel("Confirmar contraseña", { exact: true })
    .fill("NuevaClave9");
  await page.getByRole("button", { name: "Restablecer contraseña" }).click();
  await expect(page.getByRole("status")).toContainText("se actualizó");
  await expect(page.getByLabel("Contraseña", { exact: true })).toHaveValue("");
  expect(actions).toEqual(["recover", "verify", "reset"]);
});

test("anonymous users cannot load the worker panel or orders", async ({
  page,
  request,
}) => {
  await page.goto("/worker");
  await expect(page).toHaveURL(/\/panel\/login$/);
  expect((await request.get("/api/orders")).status()).toBe(401);
  expect(
    (
      await request.post("/api/auth/login", {
        headers: { origin: "https://evil.example" },
        data: {},
      })
    ).status(),
  ).toBe(403);
});

test("desktop login stays readable and scrollable on short screens", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/login");
  // Interact first so the screenshot's caret styling cannot race hydration.
  await page.getByRole("button", { name: "Mostrar contraseña" }).click();
  await page.getByRole("button", { name: "Ocultar contraseña" }).click();
  await page.screenshot({
    path: testInfo.outputPath("login-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 320, height: 568 });
  await page
    .getByRole("link", { name: "Registrarse como estudiante" })
    .scrollIntoViewIfNeeded();
  await expect(
    page.getByRole("link", { name: "Registrarse como estudiante" }),
  ).toBeInViewport();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

import { test, expect } from "@playwright/test";

test.skip(
  !!process.env.PLAYWRIGHT_BASE_URL,
  "Requires the controlled local auth provider",
);

test("root opens a desktop panel login with explicit context and no student registration", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page).toHaveURL(/\/panel\/login$/);
  await expect(
    page.getByRole("heading", { name: "Acceso al panel", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Tu cafetería, en un solo lugar.",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Registrarse como estudiante" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "¿Olvidaste tu contraseña?" }),
  ).toHaveAttribute("href", "/recuperar-contrasena?entrypoint=panel");
  await page.screenshot({
    path: testInfo.outputPath("panel-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("heading", { name: "Acceso al panel", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.goto("/login");
  await expect(
    page.getByRole("link", { name: "Registrarse como estudiante" }),
  ).toHaveAttribute("href", "/registro");
});

test("real API enforces the four roles by two entrypoints and erases rejected sessions", async ({
  page,
}) => {
  for (const [name, target] of [
    ["client", "/cuenta"],
    ["worker", "/worker"],
    ["admin", "/admin"],
    ["superadmin", "/super-admin"],
  ]) {
    for (const entrypoint of ["client", "panel"]) {
      await page.context().clearCookies();
      const response = await page.request.post("/api/auth/login", {
        headers: {
          origin: new URL(test.info().project.use.baseURL as string).origin,
        },
        data: {
          email: name + "@example.invalid",
          password: "UnaClave8",
          remember: true,
          entrypoint,
          user_metadata: { role: "SUPER_ADMIN" },
          role: "SUPER_ADMIN",
        },
      });
      const accepted = (name === "client") === (entrypoint === "client");
      expect(response.status()).toBe(accepted ? 200 : 403);
      const cookies = await page.context().cookies();
      if (accepted) {
        expect(await response.json()).toEqual({ redirect: target });
        expect(
          cookies.find(({ name }) => name === "unifood-remember")?.value,
        ).toBe("1");
      } else {
        expect((await response.json()).redirect).toBeUndefined();
        expect(cookies).toEqual([]);
        expect((await page.request.get("/api/orders")).status()).toBe(401);
      }
    }
  }
});

for (const [name, entrypoint, target] of [
  ["client", "client", "/cuenta"],
  ["worker", "panel", "/worker"],
  ["admin", "panel", "/admin"],
  ["superadmin", "panel", "/super-admin"],
]) {
  test(`${name} uses its entrypoint, keeps its actual destination and logs out contextually`, async ({
    page,
  }) => {
    const login = entrypoint === "client" ? "/login" : "/panel/login";
    await page.goto(login);
    await page
      .getByLabel("Usuario o correo institucional", { exact: true })
      .fill(name + "@example.invalid");
    await page.getByLabel("Contraseña", { exact: true }).fill("UnaClave8");
    await page
      .getByRole("button", { name: "Iniciar sesión", exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(target + "$"));
    for (const path of ["/login", "/panel/login", "/registro", "/cuenta"]) {
      await page.goto(path);
      await expect(page).toHaveURL(new RegExp(target + "$"));
    }
    await page
      .getByRole("button", { name: "Cerrar sesión", exact: true })
      .click();
    await expect(page).toHaveURL(new URL(login, page.url()).href);
    expect(await page.context().cookies()).toEqual([]);
  });
}

test("panel login can confirm OTP without entering student registration and remembers only after admission", async ({
  page,
}) => {
  await page.goto("/panel/login");
  await page
    .getByLabel("Usuario o correo institucional", { exact: true })
    .fill("unverifiedworker@example.invalid");
  await page.getByLabel("Contraseña", { exact: true }).fill("UnaClave8");
  await page
    .getByRole("button", { name: "Iniciar sesión", exact: true })
    .click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Verifica tu correo",
  );
  expect(
    (await page.context().cookies()).find(
      ({ name }) => name === "unifood-remember",
    ),
  ).toBeUndefined();
  await page
    .getByRole("button", { name: "Verificar mi correo", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Dígito 1", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("list", { name: "Progreso del registro" }),
  ).toHaveCount(0);
  await page
    .getByRole("textbox", { name: "Dígito 1", exact: true })
    .fill("123456");
  await page.getByRole("button", { name: "Verificar", exact: true }).click();
  await expect(page).toHaveURL(/\/worker$/);
  expect(
    (await page.context().cookies()).find(
      ({ name }) => name === "unifood-remember",
    )?.value,
  ).toBe("1");
});

for (const entrypoint of ["client", "panel"]) {
  test(`recovery preserves the temporary OTP session and the ${entrypoint} login variant`, async ({
    page,
  }) => {
    await page.goto("/recuperar-contrasena?entrypoint=" + entrypoint);
    await page
      .getByRole("textbox")
      .fill(
        (entrypoint === "client" ? "client" : "worker") + "@example.invalid",
      );
    await page
      .getByRole("button", { name: "Enviar código", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "Si existe una cuenta",
    );
    await page
      .getByRole("textbox", { name: "Dígito 1", exact: true })
      .fill("123456");
    await page.getByRole("button", { name: "Verificar", exact: true }).click();
    await expect(
      page.getByLabel("Confirmar contraseña", { exact: true }),
    ).toBeVisible();
    expect((await page.context().cookies()).length).toBeGreaterThan(0);
    await page.getByLabel("Contraseña", { exact: true }).fill("NuevaClave9");
    await page
      .getByLabel("Confirmar contraseña", { exact: true })
      .fill("NuevaClave9");
    await page
      .getByRole("button", { name: "Restablecer contraseña", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText("se actualizó");
    await expect(
      page.getByRole("heading", {
        name:
          entrypoint === "panel" ? "Acceso al panel" : "Tu comida, sin filas",
        exact: true,
      }),
    ).toBeVisible();
    const link = page.getByRole("link", {
      name: "UniFood — inicio",
      exact: true,
    });
    await expect(link).toHaveAttribute(
      "href",
      entrypoint === "panel" ? "/panel/login" : "/login",
    );
    expect(await page.context().cookies()).toEqual([]);
  });
}

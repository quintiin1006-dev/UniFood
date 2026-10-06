import { test, expect as baseExpect } from "@playwright/test";

// Account and role pages compile on their first visit in the development server.
const expect = baseExpect.configure({ timeout: 20_000 });

// These tests exercise real Next.js pages/BFF using a loopback provider fixture.
test.skip(
  !!process.env.PLAYWRIGHT_BASE_URL,
  "Role fixtures require the controlled local test servers.",
);

for (const [name, target] of [
  ["client", "/cuenta"],
  ["admin", "/admin"],
  ["superadmin", "/super-admin"],
]) {
  test(`${name} follows its database destination and cannot access worker operations`, async ({
    page,
  }) => {
    await page.goto(name === "client" ? "/login" : "/panel/login");
    await page
      .getByLabel("Usuario o correo institucional", { exact: true })
      .fill(`${name}@example.invalid`);
    await page.getByLabel("Contraseña", { exact: true }).fill("UnaClave8");
    await page
      .getByRole("button", { name: "Iniciar sesión", exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`${target}$`));
    for (const entry of ["/login", "/panel/login", "/registro"]) {
      await page.goto(entry);
      await expect(page).toHaveURL(new RegExp(`${target}$`));
    }
    await expect(
      page.getByRole("link", { name: "Ir al panel de trabajador" }),
    ).toHaveCount(0);
    await page.goto("/worker");
    await expect(page).toHaveURL(new RegExp(`${target}$`));
    await page.goto("/cuenta");
    await expect(page).toHaveURL(new RegExp(`${target}$`));
    expect(
      (
        await page.request.get(
          "/api/orders?cafeteriaId=00000000-0000-0000-0000-000000000002",
        )
      ).status(),
    ).toBe(403);
    expect(
      (
        await page.request.patch(
          "/api/orders/00000000-0000-0000-0000-000000000001/prepare",
          { headers: { origin: new URL(page.url()).origin } },
        )
      ).status(),
    ).toBe(403);
    if (target !== "/cuenta")
      await expect(
        page.getByText(
          "El panel de administración estará disponible más adelante.",
        ),
      ).toBeVisible();
  });
}

test.describe("invalid database role cardinality is denied at login and session loading", () => {
  for (const name of [
    "workeradmin",
    "workersuperadmin",
    "clientworker",
    "clientadmin",
    "clientsuperadmin",
    "adminsuperadmin",
    "norole",
    "unknownrole",
  ]) {
    test(`${name} cannot authenticate or reach any protected role destination`, async ({
      page,
    }) => {
      await page.goto("/panel/login");
      await page
        .getByLabel("Usuario o correo institucional", { exact: true })
        .fill(`${name}@example.invalid`);
      await page.getByLabel("Contraseña", { exact: true }).fill("UnaClave8");
      await page
        .getByRole("button", { name: "Iniciar sesión", exact: true })
        .click();
      await expect(page.getByRole("main").getByRole("alert")).toContainText(
        "Tu cuenta no está habilitada",
      );
      await expect(page).toHaveURL(/\/panel\/login$/);
      for (const path of ["/cuenta", "/worker", "/admin", "/super-admin"]) {
        await page.goto(path);
        await expect(page).toHaveURL(
          new URL(path === "/cuenta" ? "/login" : "/panel/login", page.url())
            .href,
        );
      }
      expect((await page.request.get("/api/orders")).status()).toBe(401);
      expect(
        (
          await page.request.patch(
            "/api/me/orders/00000000-0000-0000-0000-000000000010/cancel",
            { headers: { origin: new URL(page.url()).origin } },
          )
        ).status(),
      ).toBe(401);
    });
  }
});

test("worker login loads its dashboard and can prepare an assigned order", async ({
  page,
}) => {
  await page.goto("/panel/login");
  await page
    .getByLabel("Usuario o correo institucional", { exact: true })
    .fill("worker@example.invalid");
  await page.getByLabel("Contraseña", { exact: true }).fill("UnaClave8");
  await page
    .getByRole("button", { name: "Iniciar sesión", exact: true })
    .click();
  await expect(page).toHaveURL(/\/worker$/);
  await page.goto("/cuenta");
  await expect(page).toHaveURL(/\/worker$/);
  await expect(
    page.getByText("Gestión de pedidos", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Estudiante de prueba", { exact: true }),
  ).toBeVisible();
  const ownOrders = await page.request.get(
    "/api/orders?cafeteriaId=another-cafeteria",
  );
  expect(ownOrders.status()).toBe(200);
  expect(
    (await ownOrders.json()).map(
      (order: { cafeteriaId: string }) => order.cafeteriaId,
    ),
  ).toEqual(["00000000-0000-0000-0000-000000000002"]);
  await page
    .getByRole("button", { name: "Pasar a preparación", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Marcar como listo", exact: true }),
  ).toBeVisible();
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/worker$/);
  await page.goto("/super-admin");
  await expect(page).toHaveURL(/\/worker$/);
});

for (const name of ["unassigned", "multiassigned"]) {
  test(`${name} worker sees a safe context error and cannot operate orders`, async ({
    page,
  }) => {
    await page.goto("/panel/login");
    await page
      .getByLabel("Usuario o correo institucional", { exact: true })
      .fill(`${name}@example.invalid`);
    await page.getByLabel("Contraseña", { exact: true }).fill("UnaClave8");
    await page
      .getByRole("button", { name: "Iniciar sesión", exact: true })
      .click();
    await expect(page).toHaveURL(/\/worker$/);
    await expect(
      page.getByText("No se pudo resolver la cafetería de tu cuenta.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Pasar a preparación", exact: true }),
    ).toHaveCount(0);
    expect(
      (
        await page.request.patch(
          "/api/orders/00000000-0000-0000-0000-000000000001/prepare",
          { headers: { origin: new URL(page.url()).origin } },
        )
      ).status(),
    ).toBe(403);
  });
}

test("inactive worker is denied at login", async ({ page }) => {
  await page.goto("/panel/login");
  await page
    .getByLabel("Usuario o correo institucional", { exact: true })
    .fill("inactive@example.invalid");
  await page.getByLabel("Contraseña", { exact: true }).fill("UnaClave8");
  await page
    .getByRole("button", { name: "Iniciar sesión", exact: true })
    .click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Tu cuenta no está habilitada",
  );
  await expect(page).toHaveURL(new URL("/panel/login", page.url()).href);
  await page.goto("/worker");
  await expect(page).toHaveURL(new URL("/panel/login", page.url()).href);
  expect((await page.request.get("/api/orders")).status()).toBe(401);
});

test("administrative placeholders reject anonymous users", async ({ page }) => {
  for (const path of ["/admin", "/super-admin"]) {
    await page.goto(path);
    await expect(page).toHaveURL(new URL("/panel/login", page.url()).href);
  }
});

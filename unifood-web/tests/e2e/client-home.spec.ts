import { test, expect, type Page } from "@playwright/test";

test.skip(
  !!process.env.PLAYWRIGHT_BASE_URL,
  "Requires the controlled local auth provider",
);

async function login(
  page: Page,
  email = "client@example.invalid",
  entrypoint = "client",
) {
  const origin = new URL(test.info().project.use.baseURL as string).origin;
  const response = await page.request.post("/api/auth/login", {
    headers: { origin },
    data: { email, password: "UnaClave8", entrypoint },
  });
  expect(response.status()).toBe(200);
}
async function assertNoOverflow(page: Page) {
  expect(
    await page.evaluate(() => {
      const main = document.querySelector("main")!;
      return (
        document.documentElement.scrollWidth <= innerWidth &&
        main.scrollWidth <= main.clientWidth
      );
    }),
  ).toBe(true);
}
async function imagesLoaded(page: Page) {
  for (const image of await page.locator("main img").all()) {
    if (
      await image.evaluate(
        (element) => !!element.closest('[aria-hidden="true"]'),
      )
    )
      continue;
    await image.scrollIntoViewIfNeeded();
    await expect
      .poll(() =>
        image.evaluate((element) => (element as HTMLImageElement).naturalWidth),
      )
      .toBeGreaterThan(0);
  }
}

for (const width of [320, 375, 390, 412, 430, 1280]) {
  test(`site selection, home, menu and profile fit ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await page.clock.setFixedTime(new Date("2026-10-07T12:00:00-05:00"));
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await login(page);
    await page.goto("/cuenta");
    const nav = page.getByRole("navigation", {
      name: "Navegación del estudiante",
    });
    await expect(
      page.getByRole("heading", { name: "¿Dónde vas a pedir hoy?" }),
    ).toBeVisible();
    await expect(nav.getByRole("link")).toHaveCount(3);
    await expect(
      nav.getByRole("button", { name: "Pedidos, próximamente" }),
    ).toBeDisabled();
    await expect(
      nav.getByRole("link", { name: "Inicio", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await expect(
      page.getByRole("list", { name: "Sedes" }).getByRole("link"),
    ).toHaveCount(2);
    await imagesLoaded(page);
    await assertNoOverflow(page);
    await page.screenshot({ path: testInfo.outputPath(`sites-${width}.png`) });
    await page
      .getByRole("link", { name: "Sede Principal Villavicencio" })
      .click();
    await expect(page).toHaveURL(/sede=principal/);
    await expect(
      page.getByRole("heading", { name: "¡Hola, Usuario!" }),
    ).toBeVisible();
    await expect(
      page.getByText("Cafetería Central", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Pausar carrusel", exact: true })
      .click();
    await expect(page.getByText(/Vista de ejemplo/)).toHaveCount(0);
    await imagesLoaded(page);
    await assertNoOverflow(page);
    await page.getByRole("main").evaluate((element) => {
      element.scrollTop = 0;
    });
    await page.screenshot({ path: testInfo.outputPath(`home-${width}.png`) });
    for (const control of await nav.getByRole("link").all()) {
      const box = (await control.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    await page.getByRole("main").evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    const notice = page.getByText("Horarios de atención de Colombia.");
    await expect(notice).toBeInViewport();
    const noticeBox = (await notice.boundingBox())!;
    expect(noticeBox.y + noticeBox.height).toBeLessThanOrEqual(
      (await nav.boundingBox())!.y,
    );
    await page.getByRole("link", { name: /^Almuerzos/ }).click();
    await expect(
      page.getByRole("heading", { name: "Almuerzos", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("article")).toHaveCount(6);
    await imagesLoaded(page);
    await assertNoOverflow(page);
    await page.getByRole("main").evaluate((element) => {
      element.scrollTop = 0;
    });
    await page.screenshot({ path: testInfo.outputPath(`menu-${width}.png`) });
    await page.getByRole("link", { name: /^Pechuga a la plancha/ }).click();
    await expect(
      page.getByRole("heading", { name: "Pechuga a la plancha" }),
    ).toBeVisible();
    await page
      .getByRole("textbox", { name: /Observaciones/ })
      .fill("Sin cubiertos");
    const addButton = page.getByRole("button", {
      name: "Agregar al carrito",
      exact: true,
    });
    await addButton.scrollIntoViewIfNeeded();
    await assertNoOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath(`product-${width}.png`),
    });
    await addButton.click();
    await expect(
      nav.getByRole("link", { name: "Carrito, 1 plato", exact: true }),
    ).toBeVisible();
    await nav
      .getByRole("link", { name: "Carrito, 1 plato", exact: true })
      .click();
    await expect(page).toHaveURL(/\/cuenta\/carrito$/);
    await expect(
      page.getByRole("heading", { name: "Tu carrito", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Sin cubiertos", { exact: true }),
    ).toBeVisible();
    await assertNoOverflow(page);
    await page.screenshot({ path: testInfo.outputPath(`cart-${width}.png`) });
    await nav.getByRole("link", { name: "Perfil", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Mi perfil" }),
    ).toBeVisible();
    await expect(page.getByText("1234567890", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Sin registrar", { exact: true }),
    ).toBeAttached();
    await expect(
      page.getByText("Universidad de prueba", { exact: true }),
    ).toHaveCount(2);
    await expect(
      nav.getByRole("link", { name: "Perfil", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await assertNoOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath(`profile-${width}.png`),
    });
    await page
      .getByRole("link", { name: "Cambiar contraseña", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Cambiar contraseña" }),
    ).toBeVisible();
    await assertNoOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath(`password-${width}.png`),
    });
    await page.getByRole("link", { name: "Continuar por correo" }).click();
    await expect(page).toHaveURL(/\/recuperar-contrasena\?entrypoint=client$/);
    expect(errors).toEqual([]);
  });
}

test("menu search, categories and changing sites work without operational API requests", async ({
  page,
}) => {
  const operationalRequests: string[] = [];
  await page.clock.setFixedTime(new Date("2026-10-07T12:00:00-05:00"));
  page.on("request", (request) => {
    if (
      /\/api\/(orders|me\/orders|worker)/.test(new URL(request.url()).pathname)
    )
      operationalRequests.push(request.url());
  });
  await login(page);
  await page.goto("/cuenta?sede=aguas-claras");
  await expect(
    page.getByText("Cafetería Aguas Claras", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: /^Almuerzos/ }).click();
  const search = page.getByRole("searchbox", { name: "Buscar en el menú" });
  await search.fill("  PECHUGA  ");
  await expect(page.getByRole("article")).toHaveCount(1);
  await search.fill("sin coincidencias");
  await expect(
    page.getByRole("heading", { name: "No encontramos coincidencias" }),
  ).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("0 platos");
  await page.getByRole("button", { name: "Limpiar búsqueda" }).click();
  await expect(search).toBeFocused();
  await expect(search).toHaveValue("");
  await expect(page.getByRole("article")).toHaveCount(6);
  await page
    .getByRole("link", { name: "Volver al inicio", exact: true })
    .click();
  await expect(page).toHaveURL(/sede=aguas-claras/);
  for (const [name, count] of [
    ["Ejecutivos", 2],
    ["Especiales", 1],
  ] as const) {
    await page.goto(
      `/cuenta/menu?sede=aguas-claras&categoria=${name.toLowerCase()}`,
    );
    await expect(
      page.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("article")).toHaveCount(count);
    await page
      .getByRole("link", { name: "Volver al inicio", exact: true })
      .click();
  }
  await page.getByRole("link", { name: /^Cambiar sede/ }).click();
  await expect(page).toHaveURL(/\/cuenta$/);
  for (const invalid of [
    "/cuenta/menu",
    "/cuenta/menu?sede=principal&categoria=inventada",
    "/cuenta/menu?sede=principal&sede=aguas-claras&categoria=corriente",
  ]) {
    await page.goto(invalid);
    await expect(page).toHaveURL(/\/cuenta$/);
  }
  expect(operationalRequests).toEqual([]);
});

test("short viewport and long profile values remain reachable; logout protects subroutes", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 480 });
  await page.clock.setFixedTime(new Date("2026-10-07T12:00:00-05:00"));
  const email =
    "estudiante.con.correo.institucional.extenso@universidad-de-ejemplo.example.invalid";
  await login(page, email);
  await page.goto("/cuenta?sede=principal");
  await assertNoOverflow(page);
  await page.goto("/cuenta/menu?sede=principal&categoria=corriente");
  const search = page.getByRole("searchbox");
  await search.fill("pollo");
  await page.setViewportSize({ width: 320, height: 360 });
  await search.scrollIntoViewIfNeeded();
  await expect(search).toBeInViewport();
  await assertNoOverflow(page);
  await page
    .getByRole("navigation", { name: "Navegación del estudiante" })
    .getByRole("link", { name: "Perfil", exact: true })
    .click();
  await expect(page.getByText(email, { exact: true })).toHaveCount(2);
  await assertNoOverflow(page);
  const logout = page.getByRole("button", {
    name: "Cerrar sesión",
    exact: true,
  });
  await logout.scrollIntoViewIfNeeded();
  await expect(logout).toBeInViewport();
  await logout.click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/cuenta/perfil/contrasena");
  await expect(page).toHaveURL(/\/login$/);
});

test("all student subroutes reject anonymous and non-client sessions", async ({
  page,
}) => {
  const paths = [
    "/cuenta",
    "/cuenta/perfil",
    "/cuenta/menu?sede=principal&categoria=corriente",
    "/cuenta/perfil/contrasena",
    "/cuenta/carrito",
    "/cuenta/producto/chicken?sede=principal",
  ];
  for (const path of paths) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login$/);
  }
  for (const [name, destination] of [
    ["worker", "/worker"],
    ["admin", "/admin"],
    ["superadmin", "/super-admin"],
  ]) {
    await page.context().clearCookies();
    await login(page, `${name}@example.invalid`, "panel");
    for (const path of paths) {
      await page.goto(path);
      await expect(page).toHaveURL(new URL(destination, page.url()).href);
    }
  }
});

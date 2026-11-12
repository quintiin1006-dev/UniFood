import { test, expect, type Page } from "@playwright/test";
import {
  CAFETERIA_AGUAS_CLARAS,
  CAFETERIA_BLOQUE_B,
  CAFETERIA_CENTRAL,
  CAFETERIA_FAILING,
  PRODUCT,
  SITE_NORTE,
} from "../fixtures/client-menu";

test.skip(
  !!process.env.PLAYWRIGHT_BASE_URL,
  "Requires the controlled local auth provider",
);

const LONG_EMAIL =
  "estudiante.con.correo.institucional.extenso@universidad-de-ejemplo.example.invalid";

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
/** Inicio, Menú and Producto never show service hours or the hours preview. */
async function assertNoHours(page: Page) {
  await expect(page.getByText("Probar sin horario")).toHaveCount(0);
  await expect(page.getByText(/a\. m\.|p\. m\.|Horario/)).toHaveCount(0);
}
const nav = (page: Page) =>
  page.getByRole("navigation", { name: "Navegación del estudiante" });

for (const width of [320, 375, 390, 412, 430, 1280]) {
  test(`site, cafeteria, home, menu, product and profile fit ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await login(page);
    await page.goto("/cuenta");
    await expect(
      page.getByRole("heading", { name: "¿Dónde vas a pedir hoy?" }),
    ).toBeVisible();
    await expect(nav(page).getByRole("link")).toHaveCount(3);
    await expect(
      nav(page).getByRole("link", { name: "Inicio", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    const sites = page.getByRole("list", { name: "Sedes" }).getByRole("link");
    await expect(sites).toHaveCount(3);
    // The context has no city or image for sites.
    await expect(page.getByText("Villavicencio")).toHaveCount(0);
    await expect(page.locator("main img")).toHaveCount(0);
    await assertNoOverflow(page);
    await page.screenshot({ path: testInfo.outputPath(`sites-${width}.png`) });

    await page.getByRole("link", { name: /^Sede Principal/ }).click();
    await expect(
      page.getByRole("heading", { name: "Elige tu cafetería" }),
    ).toBeVisible();
    const cafeterias = page
      .getByRole("list", { name: "Cafeterías" })
      .getByRole("link");
    await expect(cafeterias).toHaveCount(2);
    await expect(cafeterias.nth(1)).toContainText("Cerrada por ahora");
    await assertNoOverflow(page);
    await cafeterias.filter({ hasText: "Cafetería Central" }).click();

    await expect(page).toHaveURL(`/cuenta?cafeteria=${CAFETERIA_CENTRAL}`);
    await expect(
      page.getByRole("heading", { name: "¡Hola, Usuario!" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", {
        name: "Cambiar cafetería. Cafetería Central, Sede Principal, Abierta",
      }),
    ).toBeVisible();
    const filters = page
      .getByRole("list", { name: "Filtrar por categoría" })
      .getByRole("button");
    await expect(filters).toHaveText([
      "Todo",
      "Del día",
      "Desayunos",
      "Corriente",
      "Ejecutivo",
      "Especial",
      "Bebidas",
    ]);
    await expect(filters.first()).toHaveAttribute("aria-pressed", "true");
    for (const name of [
      "Del día",
      "Desayunos",
      "Corriente",
      "Ejecutivo",
      "Bebidas",
    ])
      await expect(
        page.getByRole("heading", { level: 2, name, exact: true }),
      ).toBeVisible();
    // Only available products ride the carousel; a category without any is one line (§6).
    await expect(
      page
        .getByRole("list", { name: "Productos: Corriente" })
        .getByRole("link"),
    ).toHaveCount(1);
    await expect(
      page.getByText(
        "Especial: No hay productos disponibles de esta categoría por el momento.",
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("list", { name: "Productos: Especial" }),
    ).toHaveCount(0);
    await assertNoHours(page);
    await assertNoOverflow(page);
    await page.screenshot({ path: testInfo.outputPath(`home-${width}.png`) });

    await filters.filter({ hasText: "Bebidas" }).click();
    await expect(filters.last()).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("heading", { level: 2 })).toHaveText([
      "Bebidas",
    ]);
    await expect(
      page.getByRole("list", { name: "Productos: Bebidas" }).getByRole("link"),
    ).toHaveCount(2);
    await filters.first().click();
    await page.getByRole("link", { name: "Ver todo: Corriente" }).click();

    await expect(
      page.getByRole("heading", { name: "Corriente", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("article")).toHaveCount(2);
    await expect(
      page.getByText("No disponible por ahora", { exact: true }),
    ).toHaveCount(1);
    await assertNoHours(page);
    await assertNoOverflow(page);
    await page.screenshot({ path: testInfo.outputPath(`menu-${width}.png`) });

    await page.getByRole("link", { name: /^Pechuga a la plancha/ }).click();
    await expect(page).toHaveURL(
      `/cuenta/producto/${PRODUCT.chicken}?cafeteria=${CAFETERIA_CENTRAL}`,
    );
    await expect(
      page.getByRole("heading", { name: "Pechuga a la plancha" }),
    ).toBeVisible();
    await expect(page.getByText("Con arroz y ensalada.")).toBeVisible();
    await expect(page.getByText(/\$\s*15\.000/).first()).toBeVisible();
    // Per-line notes are gone; the single order note arrives with the checkout (PR 2).
    await expect(page.getByRole("textbox")).toHaveCount(0);
    await assertNoHours(page);
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
    const cart = nav(page).getByRole("link", {
      name: "Carrito, 1 unidad",
      exact: true,
    });
    await expect(cart).toBeVisible();
    await cart.click();
    await expect(
      page.getByRole("heading", { name: "Tu carrito", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Pechuga a la plancha" }),
    ).toBeVisible();
    await assertNoOverflow(page);
    await page.screenshot({ path: testInfo.outputPath(`cart-${width}.png`) });

    await nav(page).getByRole("link", { name: "Perfil", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Mi perfil" }),
    ).toBeVisible();
    await expect(page.getByText("1234567890", { exact: true })).toBeVisible();
    await assertNoOverflow(page);
    // Inicio returns to the chosen cafeteria.
    await nav(page).getByRole("link", { name: "Inicio", exact: true }).click();
    await expect(page).toHaveURL(`/cuenta?cafeteria=${CAFETERIA_CENTRAL}`);
    expect(errors).toEqual([]);
  });
}

test("closed, empty, failing and missing cafeterias show fixed Spanish states", async ({
  page,
}) => {
  await login(page);
  await page.goto(`/cuenta?cafeteria=${CAFETERIA_BLOQUE_B}`);
  await expect(
    page.getByText(
      "La cafetería está cerrada por ahora. Puedes ver el menú, pero no hacer pedidos hasta que abra.",
    ),
  ).toBeVisible();
  // Closed: the active products are listed to see, not to order.
  await expect(
    page.getByRole("list", { name: "Productos: Corriente" }).getByRole("link"),
  ).toHaveCount(1);
  await page
    .getByRole("list", { name: "Productos: Corriente" })
    .getByRole("link")
    .click();
  await expect(
    page.getByText(
      "La cafetería está cerrada por ahora. Podrás pedir cuando abra.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Agregar al carrito", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Aumentar cantidad" }),
  ).toBeDisabled();

  await page.goto(`/cuenta?cafeteria=${CAFETERIA_AGUAS_CLARAS}`);
  await expect(
    page.getByRole("heading", { name: "Aún no hay productos en el menú" }),
  ).toBeVisible();
  await page.goto(`/cuenta/menu?cafeteria=${CAFETERIA_AGUAS_CLARAS}`);
  await expect(
    page.getByText(
      "Aún no hay productos en el menú. Vuelve a consultar más tarde.",
    ),
  ).toBeVisible();

  await page.goto(`/cuenta?cafeteria=${CAFETERIA_FAILING}`);
  await expect(
    page.getByRole("heading", { name: "No pudimos cargar el menú" }),
  ).toBeVisible();
  await expect(page.locator("body")).not.toContainText("PRIVATE");
  await page.getByRole("button", { name: "Volver a intentar" }).click();
  await expect(
    page.getByRole("heading", { name: "No pudimos cargar el menú" }),
  ).toBeVisible();

  await page.goto(`/cuenta?sede=${SITE_NORTE}`);
  await expect(
    page.getByRole("heading", {
      name: "Aún no hay cafeterías disponibles en tu sede",
    }),
  ).toBeVisible();

  await page.goto("/cuenta?cafeteria=00000000-0000-4000-8000-999999999999");
  await expect(
    page.getByText(
      "La cafetería que elegiste ya no está disponible. Elige otra para continuar.",
    ),
  ).toBeVisible();

  await page.goto(
    `/cuenta/producto/00000000-0000-4000-8000-999999999999?cafeteria=${CAFETERIA_CENTRAL}`,
  );
  await expect(
    page.getByRole("heading", { name: "Este producto no está disponible" }),
  ).toBeVisible();
  await page.goto(
    `/cuenta/producto/${PRODUCT.fish}?cafeteria=${CAFETERIA_CENTRAL}`,
  );
  await expect(
    page.getByText("Este producto no está disponible por ahora."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Agregar al carrito", exact: true }),
  ).toBeDisabled();
});

test("menu search and category links use the real menu without operational requests", async ({
  page,
}) => {
  const operationalRequests: string[] = [];
  page.on("request", (request) => {
    if (
      /\/api\/(orders|me\/orders|worker)/.test(new URL(request.url()).pathname)
    )
      operationalRequests.push(request.url());
  });
  await login(page);
  await page.goto(`/cuenta/menu?cafeteria=${CAFETERIA_CENTRAL}`);
  await expect(
    page.getByRole("heading", { name: "Menú completo" }),
  ).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(9);
  const search = page.getByRole("searchbox", { name: "Buscar en el menú" });
  await search.fill("  PECHUGA  ");
  await expect(page.getByRole("article")).toHaveCount(1);
  await search.fill("limon");
  await expect(page.getByRole("article")).toHaveText([/Limonada de coco/]);
  await search.fill("sin coincidencias");
  await expect(
    page.getByRole("heading", { name: "No encontramos coincidencias" }),
  ).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("0 productos");
  await page.getByRole("button", { name: "Limpiar búsqueda" }).click();
  await expect(search).toBeFocused();
  const categories = page.getByRole("list", { name: "Categorías" });
  await categories.getByRole("link", { name: "Bebidas" }).click();
  await expect(page).toHaveURL(/categoria=bebidas$/);
  await expect(
    categories.getByRole("link", { name: "Bebidas" }),
  ).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("article")).toHaveCount(2);
  await categories.getByRole("link", { name: "Especial" }).click();
  await expect(page.getByRole("article")).toHaveCount(1);
  for (const [path, destination] of [
    ["/cuenta/menu", "/cuenta"],
    [
      `/cuenta/menu?cafeteria=${CAFETERIA_CENTRAL}&categoria=postres`,
      `/cuenta/menu?cafeteria=${CAFETERIA_CENTRAL}`,
    ],
    ["/cuenta/menu?cafeteria=principal", "/cuenta?cafeteria=principal"],
    ["/cuenta/producto/chicken?sede=principal", "/cuenta"],
  ]) {
    await page.goto(path);
    await expect(page).toHaveURL(destination);
  }
  expect(operationalRequests).toEqual([]);
});

test("one cafeteria skips the selection, the selector stays visible, and the last choice is cached", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 480 });
  await login(page, LONG_EMAIL);
  await page.goto("/cuenta");
  await expect(page).toHaveURL(/\/cuenta$/);
  await expect(page.getByRole("heading", { name: /^¡Hola/ })).toBeVisible();
  await assertNoOverflow(page);
  await page.getByRole("link", { name: /^Cambiar cafetería/ }).click();
  await expect(page).toHaveURL(/elegir=1/);
  await expect(
    page.getByRole("heading", { name: "Elige tu cafetería" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Cambiar de sede" })).toHaveCount(
    0,
  );
  await page
    .getByRole("list", { name: "Cafeterías" })
    .getByRole("link")
    .click();
  await expect(page).toHaveURL(`/cuenta?cafeteria=${CAFETERIA_CENTRAL}`);

  await page.context().clearCookies();
  await login(page);
  // Another account never restores this one's cached cafeteria.
  await page.goto("/cuenta");
  await expect(
    page.getByRole("heading", { name: "¿Dónde vas a pedir hoy?" }),
  ).toBeVisible();
  await page.goto(`/cuenta?cafeteria=${CAFETERIA_BLOQUE_B}`);
  await expect(page.getByRole("heading", { name: /^¡Hola/ })).toBeVisible();
  await page.goto("/cuenta");
  await expect(page).toHaveURL(`/cuenta?cafeteria=${CAFETERIA_BLOQUE_B}`);
  // The selector opens the selection without jumping back to the cached one.
  await page.getByRole("link", { name: /^Cambiar cafetería/ }).click();
  await expect(
    page.getByRole("heading", { name: "¿Dónde vas a pedir hoy?" }),
  ).toBeVisible();
  await page.getByRole("link", { name: /^Sede Aguas Claras/ }).click();
  await expect(
    page.getByRole("heading", { name: "Elige tu cafetería" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/sede=/);
});

test("short viewport and long profile values remain reachable; logout protects subroutes", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 480 });
  await login(page, LONG_EMAIL);
  await page.goto(
    `/cuenta/menu?cafeteria=${CAFETERIA_CENTRAL}&categoria=corriente`,
  );
  const search = page.getByRole("searchbox");
  await search.fill("pollo");
  await page.setViewportSize({ width: 320, height: 360 });
  await search.scrollIntoViewIfNeeded();
  await expect(search).toBeInViewport();
  await assertNoOverflow(page);
  await nav(page).getByRole("link", { name: "Perfil", exact: true }).click();
  await expect(page.getByText(LONG_EMAIL, { exact: true })).toHaveCount(2);
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
    `/cuenta/menu?cafeteria=${CAFETERIA_CENTRAL}&categoria=corriente`,
    "/cuenta/perfil/contrasena",
    "/cuenta/carrito",
    `/cuenta/producto/${PRODUCT.chicken}?cafeteria=${CAFETERIA_CENTRAL}`,
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

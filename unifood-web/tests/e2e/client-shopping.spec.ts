import { test, expect, type Page } from "@playwright/test";
test.skip(
  !!process.env.PLAYWRIGHT_BASE_URL,
  "Requires the controlled local auth provider",
);
const breakfastTime = new Date("2026-10-07T07:00:00-05:00");
const lunchTime = new Date("2026-10-07T12:00:00-05:00");
const storageKey = "unifood.client.cart.v1";
async function login(page: Page, email = "client@example.invalid") {
  const origin = new URL(test.info().project.use.baseURL as string).origin;
  const response = await page.request.post("/api/auth/login", {
    headers: { origin },
    data: { email, password: "UnaClave8", entrypoint: "client" },
  });
  expect(response.status()).toBe(200);
}
const cartNav = (page: Page) =>
  page
    .getByRole("navigation", { name: "Navegación del estudiante" })
    .getByRole("link", { name: /^Carrito/ });

test("development preview unlocks the cart after hours without showing times on slides", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.clock.setFixedTime(new Date("2026-10-07T22:00:00-05:00"));
  await login(page);
  await page.goto("/cuenta?sede=principal");
  const preview = page.getByRole("checkbox", { name: /^Probar sin horario/ });
  await expect(preview).not.toBeChecked();
  await expect(page.getByRole("button", { name: /^Desayunos/ })).toBeDisabled();
  await expect(page.getByRole("button", { name: /^Almuerzos/ })).toBeDisabled();
  const carousel = page.getByRole("region", { name: "Platos de hoy" });
  await expect(carousel).not.toContainText(/\d{1,2}:\d{2}/);
  await preview.check();
  await expect(page.getByRole("link", { name: /^Desayunos/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /^Almuerzos/ })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("after-hours-preview-320.png"),
  });
  await page.getByRole("link", { name: /^Desayunos/ }).click();
  await page
    .getByRole("link", { name: /^Huevos con arepa y chocolate/ })
    .click();
  await page
    .getByRole("button", { name: "Agregar al carrito", exact: true })
    .click();
  await expect(cartNav(page)).toHaveAccessibleName("Carrito, 1 plato");
  await page.reload();
  await expect(preview).toBeChecked();
  await page.goto("/cuenta/producto/breakfast-broth?sede=principal");
  await page
    .getByRole("button", { name: "Agregar al carrito", exact: true })
    .click();
  await cartNav(page).click();
  await expect(
    page.getByRole("heading", { name: "Tu carrito", exact: true }),
  ).toBeVisible();
  await expect(cartNav(page)).toHaveAccessibleName("Carrito, 2 platos");
  await expect(page.getByText(/Disponible de/)).toHaveCount(0);
  await preview.uncheck();
  await expect(page.getByText(/Disponible de/)).toHaveCount(2);
  await page.goto("/cuenta/producto/chicken?sede=principal");
  await expect(
    page.getByRole("button", { name: "Agregar al carrito", exact: true }),
  ).toBeDisabled();
  await preview.check();
  await page.goto("/cuenta/producto/special-fish?sede=principal");
  await expect(
    page.getByRole("button", { name: "Agregar al carrito", exact: true }),
  ).toBeDisabled();
  await page.goto("/cuenta/perfil");
  await page
    .getByRole("button", { name: "Cerrar sesión", exact: true })
    .click();
  await expect(page).toHaveURL(/\/login$/);
  await login(page);
  await page.goto("/cuenta?sede=aguas-claras");
  await expect(preview).not.toBeChecked();
  await preview.check();
  await expect(page.getByRole("button", { name: /^Desayunos/ })).toBeDisabled();
  await expect(page.getByRole("link", { name: /^Almuerzos/ })).toBeVisible();
});

test("breakfast hours and campus restrictions update in Colombia time while the page stays open", async ({
  page,
}, testInfo) => {
  await page.clock.install({ time: breakfastTime });
  await login(page);
  await page.goto("/cuenta?sede=principal");
  await expect(page.getByRole("link", { name: /^Desayunos/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Almuerzos/ })).toBeDisabled();
  await page.getByRole("link", { name: /^Desayunos/ }).click();
  await expect(page.getByRole("article")).toHaveCount(5);
  await page.screenshot({ path: testInfo.outputPath("breakfast-menu.png") });
  await page.getByRole("link", { name: /^Desayuno completo/ }).click();
  const add = page.getByRole("button", {
    name: "Agregar al carrito",
    exact: true,
  });
  await expect(add).toBeEnabled();
  await page.clock.setSystemTime(new Date("2026-10-07T08:30:00-05:00"));
  await page.clock.runFor(61_000);
  await expect(add).toBeDisabled();
  await expect(
    page.getByRole("status", { name: "Disponibilidad del plato" }),
  ).toContainText("Disponible de 6:00");
  await page.goto("/cuenta?sede=aguas-claras");
  await expect(
    page.getByRole("button", {
      name: /Desayunos.*Disponible únicamente en la Sede Principal/,
    }),
  ).toBeDisabled();
  await page.goto("/cuenta/producto/breakfast-eggs?sede=aguas-claras");
  await expect(
    page.getByRole("heading", { name: "No encontramos este plato" }),
  ).toBeVisible();
});

test("carousel advances, wraps, pauses on interaction and supports touch without following a link", async ({
  page,
}) => {
  await page.clock.install({ time: lunchTime });
  await login(page);
  await page.goto("/cuenta?sede=principal");
  const carousel = page.getByRole("region", { name: "Platos de hoy" });
  const dots = carousel.getByRole("button", { name: /^Mostrar plato/ });
  await expect(dots).toHaveCount(5);
  await expect(
    carousel.getByRole("button", { name: "Pausar carrusel" }),
  ).toBeVisible();
  await page.clock.runFor(3100);
  await expect(dots.nth(1)).toHaveAttribute("aria-current", "true");
  await dots.nth(4).click();
  await carousel.getByRole("button", { name: "Siguiente plato" }).click();
  await expect(dots.first()).toHaveAttribute("aria-current", "true");
  await page.clock.runFor(6500);
  await expect(dots.first()).toHaveAttribute("aria-current", "true");
  const offer = carousel.getByRole("link", { name: /^Ver / });
  await offer.dispatchEvent("pointerdown", {
    clientX: 280,
    clientY: 400,
    pointerType: "touch",
    button: 0,
  });
  await offer.dispatchEvent("pointerup", {
    clientX: 120,
    clientY: 402,
    pointerType: "touch",
    button: 0,
  });
  await expect(dots.nth(1)).toHaveAttribute("aria-current", "true");
  await expect(page).toHaveURL(/\/cuenta\?sede=principal$/);
});

test("reduced motion pauses automatic slides and storage denial leaves a usable cart", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.install({ time: lunchTime });
  await page.addInitScript(() => {
    Object.defineProperty(Storage.prototype, "setItem", {
      value: () => {
        throw new DOMException("Storage denied", "SecurityError");
      },
    });
  });
  await login(page);
  await page.goto("/cuenta?sede=principal");
  const carousel = page.getByRole("region", { name: "Platos de hoy" });
  await expect(
    carousel.getByRole("button", { name: "Reproducir carrusel" }),
  ).toBeVisible();
  const first = carousel.getByRole("button", { name: /^Mostrar plato 1:/ });
  await page.clock.runFor(6500);
  await expect(first).toHaveAttribute("aria-current", "true");
  await page.goto("/cuenta/producto/chicken?sede=principal");
  await page
    .getByRole("button", { name: "Agregar al carrito", exact: true })
    .click();
  await expect(
    page.getByText(/no se pudo guardar para la próxima recarga/),
  ).toBeVisible();
  await cartNav(page).click();
  await expect(
    page.getByRole("heading", { name: "Tu carrito", exact: true }),
  ).toBeVisible();
  await expect(cartNav(page)).toHaveAccessibleName("Carrito, 1 plato");
});

test("cart updates and logout clearing synchronize between tabs", async ({
  page,
  context,
}) => {
  await page.clock.setFixedTime(lunchTime);
  await login(page);
  await page.goto("/cuenta/producto/chicken?sede=principal");
  const otherTab = await context.newPage();
  await otherTab.clock.setFixedTime(lunchTime);
  await otherTab.goto("/cuenta/carrito");
  await expect(
    otherTab.getByRole("heading", { name: "Tu carrito está vacío" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Agregar al carrito", exact: true })
    .click();
  await expect(cartNav(otherTab)).toHaveAccessibleName("Carrito, 1 plato");
  await page.goto("/cuenta/perfil");
  const logoutResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/auth/logout" &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Cerrar sesión", exact: true })
    .click();
  expect((await logoutResponse).status()).toBe(200);
  await expect(page).toHaveURL(/\/login$/);
  await expect(
    otherTab.getByRole("heading", { name: "Tu carrito está vacío" }),
  ).toBeVisible();
  await otherTab.close();
});

test("whole breakfast combos persist, enforce stock and three-meal limit, and clear on logout", async ({
  page,
}) => {
  await page.clock.setFixedTime(breakfastTime);
  await login(page);
  await page.goto("/cuenta/producto/breakfast-complete?sede=principal");
  await page.getByRole("button", { name: "Aumentar cantidad" }).click();
  await expect(
    page.getByRole("button", { name: "Aumentar cantidad" }),
  ).toBeDisabled();
  const notes = page.getByRole("textbox", { name: /Observaciones/ });
  await notes.fill("Sin cubiertos");
  await expect(notes).toHaveAttribute("maxlength", "200");
  await page
    .getByRole("button", { name: "Agregar al carrito", exact: true })
    .click();
  await expect(cartNav(page)).toHaveAccessibleName("Carrito, 2 platos");
  await page.reload();
  await expect(cartNav(page)).toHaveAccessibleName("Carrito, 2 platos");
  await expect(
    page.getByRole("button", { name: "Actualizar carrito", exact: true }),
  ).toBeDisabled();
  await page.goto("/cuenta/producto/breakfast-eggs?sede=principal");
  await page
    .getByRole("button", { name: "Agregar al carrito", exact: true })
    .click();
  await expect(cartNav(page)).toHaveAccessibleName("Carrito, 3 platos");
  await page.goto("/cuenta/producto/breakfast-broth?sede=principal");
  await expect(
    page.getByRole("button", { name: "Agregar al carrito", exact: true }),
  ).toBeDisabled();
  await cartNav(page).click();
  await expect(page.getByText("Sin cubiertos", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Tu carrito", exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/\$\s*42\.000/)).toBeVisible();
  await page.goto("/cuenta/perfil");
  await page
    .getByRole("button", { name: "Cerrar sesión", exact: true })
    .click();
  await expect(page).toHaveURL(/\/login$/);
  expect(
    await page.evaluate((key) => localStorage.getItem(key), storageKey),
  ).toBeNull();
  await login(page);
  await page.goto("/cuenta/carrito");
  await expect(
    page.getByRole("heading", { name: "Tu carrito está vacío" }),
  ).toBeVisible();
});

test("campus changes and emptying require confirmation and restore focus on cancel", async ({
  page,
}) => {
  await page.clock.setFixedTime(lunchTime);
  await login(page);
  await page.goto("/cuenta/producto/chicken?sede=principal");
  await page
    .getByRole("button", { name: "Agregar al carrito", exact: true })
    .click();
  await expect(cartNav(page)).toHaveAccessibleName("Carrito, 1 plato");
  await page.getByRole("link", { name: /^Cambiar sede/ }).click();
  const otherSite = page.getByRole("link", {
    name: "Sede Aguas Claras Villavicencio",
  });
  await otherSite.click();
  const dialog = page.getByRole("dialog", { name: "¿Cambiar de cafetería?" });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(otherSite).toBeFocused();
  await expect(cartNav(page)).toHaveAccessibleName("Carrito, 1 plato");
  await otherSite.click();
  await page.getByRole("button", { name: "Vaciar y cambiar" }).click();
  await expect(page).toHaveURL(/sede=aguas-claras/);
  await expect(cartNav(page)).toHaveAccessibleName("Carrito");
  await page.goto("/cuenta/producto/chicken?sede=aguas-claras");
  await page
    .getByRole("button", { name: "Agregar al carrito", exact: true })
    .click();
  await cartNav(page).click();
  await page
    .getByRole("button", { name: "Vaciar carrito", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "¿Vaciar tu carrito?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Conservar carrito" }).click();
  await page
    .getByRole("button", { name: "Vaciar carrito", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Vaciar carrito", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Tu carrito está vacío" }),
  ).toBeVisible();
});

test("unavailable products and another account's stored cart are not admitted", async ({
  page,
}) => {
  await page.clock.setFixedTime(lunchTime);
  await login(page);
  await page.goto("/cuenta/producto/special-fish?sede=principal");
  await expect(
    page.getByRole("button", { name: "Agregar al carrito", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText("Agotado por hoy", { exact: true }),
  ).toBeVisible();
  await page.evaluate(
    (key) =>
      localStorage.setItem(
        key,
        JSON.stringify({
          ownerId: "another-user",
          cart: {
            siteId: "principal",
            lines: [
              {
                id: "foreign",
                mealId: "chicken",
                quantity: 1,
                notes: "Private foreign note",
              },
            ],
          },
        }),
      ),
    storageKey,
  );
  await page.goto("/cuenta/carrito");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Tu carrito está vacío" }),
  ).toBeVisible();
  await expect(page.getByText("Private foreign note")).toHaveCount(0);
  await page.evaluate(
    (key) => localStorage.setItem(key, "not valid json"),
    storageKey,
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Tu carrito está vacío" }),
  ).toBeVisible();
});

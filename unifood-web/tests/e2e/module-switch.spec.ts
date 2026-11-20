import { test, expect, type Page } from "@playwright/test";

// jj/cliente-ajustes-2 · A: measures switching modules from the nav, worker and client. The
// times are printed (the report compares them); the assertions only check what must hold:
// back in a module already seen, its content is on screen without the loading skeleton.

test.skip(
  !!process.env.PLAYWRIGHT_BASE_URL,
  "Requires the controlled local auth provider",
);

async function login(
  page: Page,
  email: string,
  entrypoint: "client" | "panel",
) {
  const origin = new URL(test.info().project.use.baseURL as string).origin;
  const response = await page.request.post("/api/auth/login", {
    headers: { origin },
    data: { email, password: "UnaClave8", entrypoint },
  });
  expect(response.status()).toBe(200);
}

/** Milliseconds from the click until `ready` is visible. */
async function timeTo(page: Page, click: () => Promise<void>, ready: string) {
  const start = Date.now();
  await click();
  await page.locator(ready).first().waitFor({ state: "visible" });
  return Date.now() - start;
}

test("worker: back in Disponibilidad its content is there at once, without the skeleton", async ({
  page,
}) => {
  await login(page, "worker@example.invalid", "panel");
  await page.goto("/worker");
  const nav = page.getByRole("navigation", { name: "Navegación principal" });
  const skeletons: string[] = [];
  const first = await timeTo(
    page,
    () => nav.getByRole("button", { name: "Disponibilidad" }).click(),
    '[aria-labelledby="availability-cafeteria-name"]',
  );
  await nav.getByRole("button", { name: "Pedidos" }).click();
  await page.locator('[aria-label="Cargando disponibilidad"]').waitFor({
    state: "detached",
  });
  const watch = page
    .locator('[aria-label="Cargando disponibilidad"]')
    .waitFor({ state: "attached", timeout: 1500 })
    .then(() => skeletons.push("availability"))
    .catch(() => undefined);
  const again = await timeTo(
    page,
    () => nav.getByRole("button", { name: "Disponibilidad" }).click(),
    '[aria-labelledby="availability-cafeteria-name"]',
  );
  await watch;
  console.log(
    `MEASURE worker disponibilidad first=${first}ms again=${again}ms`,
  );
  expect(skeletons).toEqual([]);
});

test("client: back in Mi pedido it paints at once", async ({ page }) => {
  await login(page, "client@example.invalid", "client");
  await page.goto("/cuenta/pedido");
  await page.getByRole("heading", { name: "Mi pedido" }).waitFor();
  const nav = page.getByRole("navigation", {
    name: "Navegación del estudiante",
  });
  const toProfile = await timeTo(
    page,
    () => nav.getByRole("link", { name: "Perfil", exact: true }).click(),
    'h1:has-text("Mi perfil"), [aria-labelledby="client-profile-title"]',
  );
  const again = await timeTo(
    page,
    () => nav.getByRole("link", { name: "Pedido", exact: true }).click(),
    'h1:has-text("Mi pedido")',
  );
  const profileAgain = await timeTo(
    page,
    () => nav.getByRole("link", { name: "Perfil", exact: true }).click(),
    '[aria-labelledby="client-profile-title"]',
  );
  console.log(
    `MEASURE client perfil first=${toProfile}ms pedido again=${again}ms perfil again=${profileAgain}ms`,
  );
});

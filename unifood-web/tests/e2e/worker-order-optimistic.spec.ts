import { test, expect, type Page } from "@playwright/test";
test.skip(
  !!process.env.PLAYWRIGHT_BASE_URL,
  "Requires controlled loopback fixtures",
);

// Ola 4 · F3: advancing an order is optimistic. The card moves at once with «Guardando…» and
// either stays (server confirms) or returns to its column with the reason (server refuses).

const STUDENT = "Estudiante de prueba";
const column = (page: Page, tone: string) =>
  page.locator(`article[data-tone="${tone}"]`);
const card = (page: Page, tone: string) =>
  column(page, tone).getByText(STUDENT, { exact: true });

async function login(page: Page) {
  // A password login resets the fixture order to PENDING.
  await page.goto("/panel/login");
  await page
    .getByLabel("Usuario o correo institucional", { exact: true })
    .fill("worker@example.invalid");
  await page.getByLabel("Contraseña", { exact: true }).fill("UnaClave8");
  await page
    .getByRole("button", { name: "Iniciar sesión", exact: true })
    .click();
  await expect(page).toHaveURL(/\/worker$/);
  await expect(card(page, "pending")).toBeVisible();
}

/** Holds the browser's PATCH until `release` is called, so the in-between state can be seen. */
function hold(page: Page, answer: "continue" | "refuse") {
  let release = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  void page.route("**/api/orders/*/prepare", async (route) => {
    await gate;
    if (answer === "continue") return route.continue();
    return route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({ code: "ORDER_CONCURRENT_MODIFICATION" }),
    });
  });
  return () => release();
}

test("an advanced order moves at once and settles when the server confirms", async ({
  page,
}) => {
  await login(page);
  const release = hold(page, "continue");
  await column(page, "pending")
    .getByRole("button", { name: "Pasar a preparación", exact: true })
    .click();

  // Before the server answers: already in «En preparación», busy and saying so.
  await expect(card(page, "preparing")).toBeVisible();
  await expect(card(page, "pending")).toHaveCount(0);
  const next = column(page, "preparing").getByRole("button", {
    name: "Marcar como listo",
    exact: true,
  });
  await expect(next).toHaveAttribute("aria-busy", "true");
  await expect(next).toContainText("Guardando…");
  await expect(next).toBeDisabled();

  release();
  await expect(next).toBeEnabled();
  await expect(next).not.toHaveAttribute("aria-busy", "true");
  await expect(next).toContainText("Marcar como listo");
  await expect(card(page, "preparing")).toBeVisible();
});

test("a refused advance returns the card to its column and explains why", async ({
  page,
}) => {
  await login(page);
  const release = hold(page, "refuse");
  await column(page, "pending")
    .getByRole("button", { name: "Pasar a preparación", exact: true })
    .click();
  await expect(card(page, "preparing")).toBeVisible();

  release();
  await expect(card(page, "pending")).toBeVisible();
  await expect(card(page, "preparing")).toHaveCount(0);
  // The board's alert (Next's route announcer is also role="alert").
  await expect(
    page.getByRole("alert").filter({
      hasText: "El pedido ya cambió de estado. Revisa el tablero actualizado.",
    }),
  ).toBeVisible();
  await expect(
    column(page, "pending").getByRole("button", {
      name: "Pasar a preparación",
      exact: true,
    }),
  ).toBeEnabled();
});

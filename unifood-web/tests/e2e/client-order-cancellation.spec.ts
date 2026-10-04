import { test, expect as baseExpect, type Page } from "@playwright/test";

const expect = baseExpect.configure({ timeout: 20_000 });
test.skip(
  !!process.env.PLAYWRIGHT_BASE_URL,
  "Requires controlled local providers.",
);
const orderId = "00000000-0000-0000-0000-000000000010";
const ownPath = `/api/me/orders/${orderId}/cancel`;

async function login(page: Page, name: string, destination: string) {
  await page.goto("/login");
  await page
    .getByLabel("Usuario o correo institucional", { exact: true })
    .fill(`${name}@example.invalid`);
  await page.getByLabel("Contraseña", { exact: true }).fill("UnaClave8");
  await page
    .getByRole("button", { name: "Iniciar sesión", exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`${destination}$`));
}

test("verified CLIENT cancels own order only, without browser identity or a deadline", async ({
  page,
}) => {
  await login(page, "client", "/cuenta");
  const headers = {
    origin: new URL(page.url()).origin,
    authorization: "Bearer forged-token",
  };
  const cancelled = await page.request.patch(
    `${ownPath}?userId=forged&clientId=forged`,
    {
      headers,
      data: { clientId: "forged", email: "other@example.invalid" },
    },
  );
  expect(cancelled.status()).toBe(200);
  expect(await cancelled.json()).toEqual({ id: orderId, status: "CANCELLED" });
  expect(cancelled.headers()["cache-control"]).toBe("no-store");
  for (const [path, status] of [
    [ownPath, 409],
    ["/api/me/orders/00000000-0000-0000-0000-000000000011/cancel", 404],
    ["/api/me/orders/00000000-0000-0000-0000-000000000012/cancel", 404],
    ["/api/me/orders/00000000-0000-0000-0000-000000000013/cancel", 404],
    ["/api/orders/00000000-0000-0000-0000-000000000001/cancel", 403],
  ] as const) {
    const response = await page.request.patch(path, { headers });
    expect(response.status()).toBe(status);
    if (status === 404)
      expect((await response.json()).code).toBe("ORDER_NOT_FOUND");
    expect(await response.text()).not.toContain("provider-secret");
  }
});

test("anonymous cancellation is unauthorized", async ({ request, baseURL }) => {
  const response = await request.patch(ownPath, {
    headers: { origin: baseURL! },
  });
  expect(response.status()).toBe(401);
});

for (const [name, destination] of [
  ["worker", "/worker"],
  ["admin", "/admin"],
  ["superadmin", "/super-admin"],
  ["clientworker", "/worker"],
  ["clientadmin", "/admin"],
  ["clientsuperadmin", "/super-admin"],
]) {
  test(`${name} cannot use the own-order CLIENT route`, async ({ page }) => {
    await login(page, name, destination);
    const response = await page.request.patch(ownPath, {
      headers: { origin: new URL(page.url()).origin },
    });
    expect(response.status()).toBe(403);
    expect(await response.text()).not.toContain("provider-secret");
  });
}

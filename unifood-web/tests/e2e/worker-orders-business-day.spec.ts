import { test, expect } from "@playwright/test";
test.skip(
  !!process.env.PLAYWRIGHT_BASE_URL,
  "Requires controlled loopback fixtures",
);

test("Pedidos Entregados shows today, excludes a 27-day-old delivery and refetches at the backend deadline", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-10-14T18:00:00Z") });
  const base = {
    cafeteriaId: "00000000-0000-0000-0000-000000000002",
    clientId: null,
    clientDocument: null,
    status: "DELIVERED",
    total: 10000,
    createdAt: "2026-01-01T10:00:00Z",
    updatedAt: "2026-10-14T18:00:00Z",
    items: [],
  };
  const today = {
    ...base,
    id: "11111111-0000-0000-0000-000000000001",
    clientName: "Entrega actual",
    deliveredAt: "2026-10-14T17:00:00Z",
  };
  const old = {
    ...base,
    id: "22222222-0000-0000-0000-000000000002",
    clientName: "Entrega antigua 27 días",
    deliveredAt: "2026-09-17T17:00:00Z",
  };
  const pending = {
    ...base,
    id: "00000000-0000-0000-0000-000000000001",
    status: "PENDING",
    clientName: "Estudiante de prueba",
    deliveredAt: null,
  };
  const cancelled = {
    ...old,
    id: "33333333-0000-0000-0000-000000000003",
    status: "CANCELLED",
    clientName: "Cancelado de otro mes",
  };
  const notCollected = {
    ...old,
    id: "44444444-0000-0000-0000-000000000004",
    status: "NOT_COLLECTED",
    clientName: "No recogido de otro mes",
  };
  const configure = async (businessDate: string) => {
    const response = await page.request.post(
      "http://127.0.0.1:3101/__test/worker-orders",
      {
        data: {
          email: "worker@example.invalid",
          data: {
            businessDate,
            orders: [pending, today, old, cancelled, notCollected],
          },
        },
      },
    );
    expect(response.status()).toBe(200);
  };
  try {
    await configure("2026-10-14");
    await page.goto("/panel/login");
    await page
      .getByLabel("Usuario o correo institucional", { exact: true })
      .fill("worker@example.invalid");
    await page.getByLabel("Contraseña", { exact: true }).fill("UnaClave8");
    await page
      .getByRole("button", { name: "Iniciar sesión", exact: true })
      .click();
    await expect(page).toHaveURL(/\/worker$/);
    await expect(
      page.getByText("Entrega actual", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Entrega antigua 27 días", { exact: true }),
    ).toHaveCount(0);
    const response = await page.request.get("/api/orders");
    expect(response.status()).toBe(200);
    expect(response.headers()["x-business-date"]).toBe("2026-10-14");
    const payload = await response.json();
    for (const terminal of ["CANCELLED", "NOT_COLLECTED"])
      expect(
        payload.map((order: { status: string }) => order.status),
      ).not.toContain(terminal);
    expect(
      payload.filter(
        (order: { status: string }) => order.status === "DELIVERED",
      ),
    ).toHaveLength(1);
    await page.clock.setSystemTime(new Date("2026-10-15T04:59:59Z"));
    const nearMidnight = page.waitForResponse(
      (response) => new URL(response.url()).pathname === "/api/orders",
    );
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await nearMidnight;
    await configure("2026-10-15");
    const midnight = page.waitForResponse(
      (response) => new URL(response.url()).pathname === "/api/orders",
    );
    await page.clock.fastForward(1000);
    await midnight;
    await expect(page.getByText("Entrega actual", { exact: true })).toHaveCount(
      0,
    );
    await expect(
      page.getByText("Estudiante de prueba", { exact: true }),
    ).toBeVisible();
  } finally {
    await page.request.post("http://127.0.0.1:3101/__test/worker-orders", {
      data: { email: "worker@example.invalid", reset: true },
    });
  }
});

import { expect, test, type Page } from "@playwright/test";

const provider = "http://127.0.0.1:3101";
const email = "client@example.invalid";

async function setTerms(page: Page, accepted: boolean) {
  expect(
    (
      await page.request.post(provider + "/__test/terms", {
        data: { email, accepted },
      })
    ).status(),
  ).toBe(200);
}

async function login(page: Page) {
  const origin = new URL(test.info().project.use.baseURL as string).origin;
  const response = await page.request.post("/api/auth/login", {
    headers: { origin },
    data: { email, password: "UnaClave8", entrypoint: "client" },
  });
  expect(response.status()).toBe(200);
}

test.afterEach(async ({ page }) => {
  await setTerms(page, true);
});

test("a client without the current terms accepts them once, before /cuenta", async ({
  page,
}) => {
  await setTerms(page, false);
  await login(page);
  await page.goto("/cuenta");
  const dialog = page.getByRole("dialog", { name: "Antes de seguir" });
  await expect(dialog).toBeVisible();
  const accept = page.getByRole("button", { name: "Aceptar y continuar" });
  await expect(accept).toBeDisabled();
  await page.getByRole("checkbox", { name: /Acepto los/ }).check();
  await accept.click();
  await expect(dialog).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

import { test, expect } from "@playwright/test";

// Ola 4 · F5: the feedback review page exists only in development; production answers 404.
test("/dev/feedback answers 404 in a production build", async ({ page }) => {
  const response = await page.request.get("/dev/feedback");
  expect(response.status()).toBe(404);
  await page.goto("/dev/feedback");
  await expect(
    page.getByRole("heading", { name: "Revisión de feedback" }),
  ).toHaveCount(0);
});

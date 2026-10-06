import { test, expect } from "@playwright/test";

for (const viewport of [
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
  { width: 390, height: 844 },
]) {
  for (const path of ["/login", "/panel/login"]) {
    test(`${path} keeps its approved layout at ${viewport.width}x${viewport.height}`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await page.goto(path);
      const logo = page.getByRole("link", {
        name: "UniFood — inicio",
        exact: true,
      });
      const form = page.locator("form");
      const identifier = page.getByLabel("Usuario o correo institucional", {
        exact: true,
      });
      const password = page.getByLabel("Contraseña", { exact: true });
      const submit = page.getByRole("button", {
        name: "Iniciar sesión",
        exact: true,
      });
      await expect(submit).toBeEnabled();
      for (const element of [logo, form, identifier, password, submit]) {
        await expect(element).toBeVisible();
        await expect(element).toBeInViewport({ ratio: 1 });
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      const boxes = await Promise.all(
        [identifier, password, submit].map((element) => element.boundingBox()),
      );
      for (let i = 1; i < boxes.length; i++) {
        const previous = boxes[i - 1]!;
        const current = boxes[i]!;
        expect(previous.y + previous.height <= current.y).toBe(true);
      }
      if (path === "/panel/login") {
        const hero = page.getByRole("complementary");
        if (viewport.width >= 960) {
          await expect(hero).toBeInViewport({ ratio: 1 });
          const heroBox = (await hero.boundingBox())!;
          const formBox = (await form.boundingBox())!;
          expect(heroBox.x + heroBox.width <= formBox.x).toBe(true);
          await expect(hero.locator("img")).toBeVisible();
          expect(
            await hero
              .locator("img")
              .evaluate(
                (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
              ),
          ).toBe(true);
        } else await expect(hero).toBeHidden(); // The approved mobile layout hides the photo.
      }
      await page.addStyleTag({
        content: "nextjs-portal { visibility: hidden !important; }",
      });
      await expect(page).toHaveScreenshot(
        `${path === "/login" ? "client" : "panel"}-${viewport.width}x${viewport.height}.png`,
        {
          animations: "disabled",
          caret: "hide",
          scale: "css",
          fullPage: true,
        },
      );
    });
  }
}

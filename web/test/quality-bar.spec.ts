// The checklist from plan-v2 section 3, applied to every screen.
import { expect, test, type Page } from "@playwright/test";
import { expectAccessible } from "./accessibility";
import { openTeam, signIn, teamUrl } from "./team";

const screens = [
  "/",
  "/attendance",
  "/team",
  "/agent/99101",
  "/coaching",
  "/coaching?view=prep&agent=99101",
  "/coaching?view=log&agent=99101",
  "/coaching?view=followups",
  "/coaching?view=history",
  "/coaching?view=fairness",
  "/quality",
  "/queues",
  "/reports",
  "/settings",
];

const settled = async (page: Page) => {
  await expect(page.locator("main .skeleton, main .loading")).toHaveCount(0);
};

test.describe("with the synthetic team", () => {
  test.use({ baseURL: teamUrl, timezoneId: "Africa/Cairo" });

  test("dark theme contrast, visible focus and styled controls", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const clean = await openTeam(page);
    await page.getByRole("button", { name: "Switch to dark theme" }).click();
    for (const path of screens) {
      await page.goto(path);
      await settled(page);
      await expectAccessible(page);
      // No control keeps the browser's own look.
      const unstyled = await page
        .locator("main select, main input[type='checkbox']")
        .evaluateAll(
          (nodes) =>
            nodes.filter((node) => getComputedStyle(node).appearance !== "none")
              .length,
        );
      expect(unstyled, path).toBe(0);
      // Keyboard focus is always visible.
      await page.locator("#main-content").focus();
      for (let i = 0; i < 12; i++) {
        await page.keyboard.press("Tab");
        const focus = await page.evaluate(() => {
          const element = document.activeElement as HTMLElement;
          const style = getComputedStyle(element);
          return {
            name: element.tagName + "." + element.className,
            visible:
              element === document.body ||
              style.outlineStyle !== "none" ||
              style.boxShadow !== "none",
          };
        });
        expect(focus.visible, `${path}: ${focus.name}`).toBe(true);
      }
    }
    clean();
  });
});

test("every screen has a calm empty state on a new installation", async ({
  page,
}) => {
  test.setTimeout(150_000);
  await signIn(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const path of screens.filter((path) => !path.includes("99101"))) {
    await page.goto(path);
    await settled(page);
    await expect(page.getByRole("alert"), path).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
      path,
    ).toBe(390);
    await expectAccessible(page);
    await page.setViewportSize({ width: 1440, height: 1000 });
  }
  expect(errors).toEqual([]);
});

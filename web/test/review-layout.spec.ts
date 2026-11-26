import { expect, test } from "@playwright/test";

test("review fixes: sticky sidebar, first-name initials, phone tiles and unobscured final content", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Password").fill("synthetic-smoke-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator(".user .avatar")).toHaveText("A");
  await page.goto("/styleguide");
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const side = await page.locator(".sidebar").boundingBox();
  expect(side?.y).toBe(0);
  expect(side?.height).toBe(1000);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("link", { name: "Floor", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign out" })).toHaveCount(0);
  for (const tile of await page.locator(".kpi-tile").all()) {
    expect(await tile.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
      true,
    );
    await expect(tile.locator(".sparkline")).toBeHidden();
  }
  for (const path of [
    "/",
    "/attendance",
    "/roster",
    "/trends",
    "/coaching",
    "/quality",
    "/queues",
    "/reports",
    "/settings",
    "/styleguide",
    "/agent/99001",
  ]) {
    await page.goto(path);
    await expect(page.locator("main .loading")).toHaveCount(0);
    await page.evaluate(() =>
      window.scrollTo(0, document.documentElement.scrollHeight),
    );
    const nav = await page.locator(".sidebar").boundingBox();
    const last = await page.locator("main.content > :last-child").boundingBox();
    expect(last, path).not.toBeNull();
    expect(last!.y + last!.height, path).toBeLessThanOrEqual(nav!.y);
  }
  await expect(page.getByRole("button", { name: "Sign out" })).toHaveCount(0);
  await page.goto("/settings");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});

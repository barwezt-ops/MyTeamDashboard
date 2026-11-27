import { expect, test } from "@playwright/test";
import { expectAccessible } from "./accessibility";

test("390 px layouts, keyboard controls, and recovery from a failed load", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let interrupt = true;
  await page.route(/\/api\/v2\/grid(?:\?|$)/, (route) => {
    if (!interrupt) return route.continue();
    return route.fulfill({
      status: 503,
      json: { error: "Fixture connection interrupted" },
    });
  });
  await page.goto("/");
  await page.getByLabel("Password").fill("synthetic-smoke-password");
  await page.getByRole("button", { name: "Sign in" }).press("Enter");
  await expect(page.locator(".sidebar")).toBeVisible();
  await page.goto("/attendance");
  await expect(page.getByRole("alert")).toHaveText(
    "Fixture connection interrupted",
  );
  interrupt = false;
  await page.getByRole("button", { name: "Retry", exact: true }).press("Enter");

  const width = () => page.evaluate(() => document.documentElement.scrollWidth);
  async function screenshot(view: string) {
    expect(await width()).toBe(390);
    await expectAccessible(page);
    await page.screenshot({
      path: testInfo.outputPath(view + "-390px.png"),
      animations: "disabled",
      fullPage: true,
    });
  }

  const grid = page.getByRole("region", { name: "Attendance grid" });
  await expect(grid.locator("tbody tr").first()).toBeVisible();
  await screenshot("attendance");
  await page.getByRole("link", { name: "Trends", exact: true }).press("Enter");
  await expect(
    page.getByRole("table", { name: "Agent trend counts" }),
  ).toBeVisible();
  await screenshot("attendance-trends");
  await page.getByRole("link", { name: "Grid", exact: true }).press("Enter");

  const agent = grid.getByRole("button", { name: "Open Riley S." });
  await agent.press("Enter");
  const drawer = page.getByRole("dialog", { name: "Agent profile" });
  await expect(
    drawer.getByRole("button", { name: "Close agent profile" }),
  ).toBeFocused();
  await expect(drawer.getByRole("heading", { name: "Riley" })).toBeVisible();
  await expectAccessible(page);
  await page.keyboard.press("Tab");
  expect(
    await page.evaluate(() => !!document.activeElement?.closest("dialog")),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(agent).toBeFocused();

  await agent.press("Enter");
  await drawer.getByRole("button", { name: "Add note" }).press("Enter");
  const note = page.getByRole("dialog", { name: "Add private note" });
  await expect(note.getByLabel("Date", { exact: true })).toBeFocused();
  await note
    .getByLabel("Note", { exact: true })
    .fill("Synthetic phone layout note");
  await note.getByRole("button", { name: "Save note" }).press("Enter");
  await expect(drawer.getByText("Synthetic phone layout note")).toBeVisible();
  await drawer.getByRole("link", { name: "Full profile" }).press("Enter");
  await expect(
    page.getByRole("heading", { name: "Riley", exact: true }),
  ).toBeVisible();
  await screenshot("agent");

  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Attendance" })
    .press("Enter");
  await page
    .getByRole("link", { name: "Review discrepancies →" })
    .press("Enter");
  const queue = page.getByRole("table", { name: "Discrepancies" });
  await expect(queue.getByRole("row").first()).toHaveCSS("display", "grid");
  await expect(
    page.getByRole("checkbox", { name: "Select all visible" }),
  ).toBeVisible();
  await screenshot("discrepancies");
});

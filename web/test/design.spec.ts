import { expect, test } from "@playwright/test";
import { expectAccessible } from "./accessibility";

test("design system: responsive samples, states, dialogs, search and local fonts", async ({
  page,
}, info) => {
  test.setTimeout(90_000);
  await page.clock.install({ time: new Date("2026-11-26T12:00:00Z") });
  const external: string[] = [];
  page.on("request", (req) => {
    if (!new URL(req.url()).hostname.match(/^(127\.0\.0\.1|localhost)$/))
      external.push(req.url());
  });
  await page.goto("/styleguide");
  await page.getByLabel("Password").fill("synthetic-smoke-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator(".sidebar")).toBeVisible();
  await page.goto("/styleguide");
  await expect(
    page.getByRole("heading", { name: "A calmer kind of clarity." }),
  ).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await expect(page.getByLabel("Team scope")).toHaveCount(0);
  await expect(
    page.getByRole("navigation", { name: "Dashboard" }).getByRole("link"),
  ).toHaveCount(8);
  for (const width of [1440, 1280, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(width);
    if (width === 1440 || width === 390)
      await page.screenshot({
        path: info.outputPath(`styleguide-${width}.png`),
        fullPage: true,
      });
    await expectAccessible(page);
  }
  await page.getByRole("button", { name: "Open sample drawer" }).click();
  const drawer = page.getByRole("dialog", { name: "Sample agent details" });
  await expect(drawer).toBeVisible();
  await page.keyboard.press("Tab");
  expect(
    await page.evaluate(() => !!document.activeElement?.closest("dialog")),
  ).toBe(true);
  await expectAccessible(page);
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Open sample drawer" }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Show toast" }).click();
  await expect(page.getByRole("status")).toContainText("No data was changed");
  await page.getByRole("button", { name: "Dismiss notification" }).click();
  const state = page.getByRole("group", { name: "Panel state" });
  for (const label of ["Empty", "Loading", "Error"]) {
    await state.getByRole("button", { name: label, exact: true }).click();
    await expect(
      state.getByRole("button", { name: label, exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expectAccessible(page);
  }
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(state.getByRole("button", { name: "Ready" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog", { name: "Find an agent or screen" });
  await expect(palette.getByLabel("Search commands")).toBeFocused();
  await palette.getByLabel("Search commands").fill("99001");
  await palette.getByRole("button", { name: /Avery/ }).press("Enter");
  await expect(
    page.getByRole("dialog", { name: "Agent profile" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+k");
  await page.getByLabel("Search commands").fill("no such command");
  await expect(page.getByText("No matching people or screens.")).toBeVisible();
  await page.getByLabel("Search commands").fill("Quality");
  await palette.getByRole("button", { name: "Quality", exact: true }).click();
  await expect(page.getByText(/Quality arrives in Phase 7/)).toBeVisible();
  for (const screen of ["coaching", "quality", "queues", "reports"]) {
    await page.goto(`/${screen}`);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBe(width);
      await page.screenshot({
        path: info.outputPath(`${screen}-${width}.png`),
        fullPage: true,
      });
    }
  }
  await page.goto("/styleguide");
  await page.getByRole("button", { name: "Switch to dark theme" }).click();
  await expectAccessible(page);
  await page.screenshot({
    path: info.outputPath("styleguide-dark-390.png"),
    fullPage: true,
  });
  expect(external).toEqual([]);
});

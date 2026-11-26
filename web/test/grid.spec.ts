import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { expectAccessible } from "./accessibility";
import { openTeam, reviewScreen, teamUrl } from "./team";

test.use({ baseURL: teamUrl, timezoneId: "Africa/Cairo" });

test("attendance grid: tooltip, drawer, keyboard, filters and export", async ({
  page,
}, info) => {
  test.setTimeout(90_000);
  const clean = await openTeam(page, "/attendance");
  const grid = page.getByRole("region", { name: "Attendance grid" });
  await expect(grid.locator("tbody tr")).toHaveCount(16);
  await expect(grid.locator("thead th")).toHaveCount(30 + 10);
  await expect(
    grid.getByRole("columnheader", { name: "25 Nov, latest results" }),
  ).toBeVisible();
  await reviewScreen(page, info, "phase-4-attendance");

  const cell = grid.getByRole("button", {
    name: "Avery S., 25 Nov: Late, 16m late",
  });
  await cell.hover();
  const tip = page.getByRole("tooltip");
  await expect(tip).toContainText("Login");
  await expect(tip).toContainText("Break");
  await cell.click();
  const drawer = page.getByRole("dialog", { name: "Avery S. · 25 Nov" });
  await expect(drawer).toContainText("Active - Site");
  await expectAccessible(page);
  await page.keyboard.press("Escape");
  await expect(cell).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(
    grid.getByRole("button", { name: /^Avery S\., 26 Nov: planned/ }),
  ).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(
    grid.getByRole("button", { name: /, 26 Nov: planned/ }).nth(1),
  ).toBeFocused();
  // Only one cell is in the tab order.
  await expect(grid.locator(".grid-cell[tabindex='0']")).toHaveCount(1);

  await page.getByLabel("Line").selectOption("Callbacks");
  await expect(grid.locator("tbody tr")).toHaveCount(5);
  await page.getByLabel("Line").selectOption("");
  await page.getByLabel("Flagged only").check();
  await expect(grid.locator("tbody tr")).toHaveCount(4);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  const csv = await readFile((await (await download).path())!, "utf8");
  expect(csv.trim().split("\r\n")).toHaveLength(5);
  expect(csv).toContain("Late (late 16m)");
  await page.getByLabel("Flagged only").uncheck();
  await page.getByLabel("Status").selectOption("Missing");
  await expect(grid.locator("tbody tr").first()).toBeVisible();
  expect(await grid.locator("tbody tr").count()).toBeLessThan(16);
  await page.getByLabel("Status").selectOption("");
  await page.getByLabel("Cycle").selectOption("2026-10-21");
  await expect(grid.locator("thead th")).toHaveCount(31 + 10);
  await page.getByRole("link", { name: "Review discrepancies →" }).click();
  await expect(
    page.getByRole("heading", { name: "Review queue" }),
  ).toBeVisible();
  clean();
});

test("team table: sort, columns, density, saved views and profile links", async ({
  page,
}, info) => {
  test.setTimeout(90_000);
  const clean = await openTeam(page, "/team");
  const table = page.getByRole("table", { name: "Team" });
  await expect(table.locator("tbody tr")).toHaveCount(16);
  await expect(
    page.getByText("Changes compare with the first 5 days"),
  ).toBeVisible();
  await reviewScreen(page, info, "phase-4-team");

  await table.getByRole("button", { name: "Late", exact: true }).click();
  await expect(table.locator("tbody tr").first()).toContainText("Avery Stone");
  await expect(
    table.getByRole("columnheader", { name: "Late", exact: true }),
  ).toHaveAttribute("aria-sort", "descending");
  await page.getByText("Columns", { exact: true }).click();
  await page.getByRole("checkbox", { name: "Overtime" }).check();
  await expect(
    table.getByRole("columnheader", { name: "Overtime" }),
  ).toBeVisible();
  await expectAccessible(page);
  await page.getByText("Columns", { exact: true }).click();
  await page.getByRole("button", { name: "Compact" }).click();
  await page.getByLabel("Save as").fill("Lateness review");
  await page.getByRole("button", { name: "Save view" }).click();
  await expect(page.getByRole("status")).toContainText("saved");
  await page.reload();
  await page.getByLabel("Saved view").selectOption("Lateness review");
  await expect(
    table.getByRole("columnheader", { name: "Overtime" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Compact" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("button", { name: "Remove view" }).click();
  await expect(page.getByLabel("Saved view").locator("option")).toHaveCount(1);
  await page.getByLabel("Search").fill("99102");
  await expect(table.locator("tbody tr")).toHaveCount(1);
  await table.locator("tbody tr").click();
  await expect(page).toHaveURL(/\/agent\/99102$/);
  clean();
});

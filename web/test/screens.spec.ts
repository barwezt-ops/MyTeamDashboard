import { expect, test } from "@playwright/test";
import { openTeam, reviewScreen, teamUrl } from "./team";

test.use({ baseURL: teamUrl, timezoneId: "Africa/Cairo" });

test("quality: averages, distribution, sorting and prep links", async ({
  page,
}, info) => {
  test.setTimeout(90_000);
  const clean = await openTeam(page, "/quality");
  const table = page.getByRole("table", { name: "Quality by agent" });
  await expect(table.locator("tbody tr")).toHaveCount(16);
  await expect(page.getByText("is not set.")).toBeVisible();
  await reviewScreen(page, info, "phase-7-quality");
  await page.getByLabel("Sort by").selectOption("Longest since evaluation");
  await expect(table.locator("tbody tr").first()).toContainText("Taylor F.");
  await table.getByRole("link", { name: "Prep sheet for Taylor F." }).click();
  await expect(page).toHaveURL(/view=prep&agent=99106/);
  clean();
});

test("queues: board, coverage gaps, leave and line changes", async ({
  page,
}, info) => {
  test.setTimeout(90_000);
  const clean = await openTeam(page, "/queues");
  await expect(page.locator(".board article")).toHaveCount(3);
  const coverage = page.getByRole("table", { name: "Coverage" });
  await expect(coverage.locator("thead th")).toHaveCount(15);
  await expect(coverage.locator("td.gap").first()).toContainText("short");
  await expect(
    page.getByRole("table", { name: "Upcoming leave" }),
  ).toContainText("26 Nov to 28 Nov");
  await expect(
    page.getByText("Moved from Inbound A to Inbound B."),
  ).toBeVisible();
  await reviewScreen(page, info, "phase-7-queues");
  clean();
});

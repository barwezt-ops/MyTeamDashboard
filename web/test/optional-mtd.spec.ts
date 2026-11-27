import { expect, test } from "@playwright/test";
import { openTeam, teamUrl } from "./team";
import { expectAccessible } from "./accessibility";

test.use({ baseURL: teamUrl, timezoneId: "Africa/Cairo" });
test("missing MTD is explicit in freshness and Settings, with row-level formula warnings", async ({
  page,
}) => {
  test.setTimeout(90000);
  const clean = await openTeam(page);
  await page.route("**/api/sync/status", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({
      response,
      json: {
        ...body,
        mtdMissing: true,
        mtdSyncedOn: null,
        mtdMismatch: [],
        pasteWarnings: ["99101", "99102"].map((code) => ({
          tab: "Attendance",
          code,
          date: "2026-11-22",
          column: "Logout Time",
          error: "#VALUE!",
          rejected: false,
        })),
      },
    });
  });
  await page.goto("/settings");
  await expect(page.locator(".freshness")).toContainText(
    "MTD for this cycle not pasted yet",
  );
  await expect(page.locator("main")).toContainText(
    "MTD for this cycle not pasted yet",
  );
  const warnings = page.getByRole("table", {
    name: "Attendance cell warnings",
  });
  await expect(warnings.locator("tbody tr")).toHaveCount(2);
  await expect(warnings).toContainText("22 Nov 2026");
  await expect(warnings).toContainText("Logout Time");
  await expect(warnings).toContainText("#VALUE!");
  await expectAccessible(page);
  clean();
});

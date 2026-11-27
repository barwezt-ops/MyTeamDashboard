import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { expectAccessible } from "./accessibility";
import { openTeam, reviewScreen, teamUrl } from "./team";

test.use({ baseURL: teamUrl, timezoneId: "Africa/Cairo" });
const clipboard = (page: import("@playwright/test").Page) =>
  page.evaluate(() => navigator.clipboard.readText());

test("reports: end of day, summary, MPR prep and roster changes", async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  const clean = await openTeam(page, "/reports");
  const eod = page.getByRole("table", { name: "End of day report" });
  await expect(eod.locator("tbody tr")).toHaveCount(6);
  await reviewScreen(page, info, "phase-8-reports");

  await page.getByRole("button", { name: "Copy report" }).click();
  await expect(page.getByRole("status")).toContainText("report copied");
  expect(await clipboard(page)).toContain("2026-11-25\tAvery S.");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export report as CSV" }).click();
  expect(await readFile((await (await download).path())!, "utf8")).toContain(
    "Avery S.",
  );
  await page.getByLabel("Report date").fill("2026-11-23");
  await expect(eod).toContainText("2026-11-23");
  await page.getByRole("button", { name: "Copy summary" }).click();
  await expect
    .poll(() => clipboard(page))
    .toContain("Cycle summary 21 Nov to 20 Dec 2026");

  await page.getByLabel("Agent", { exact: true }).selectOption("99101");
  await page.getByRole("button", { name: "Open MPR prep" }).click();
  await expect(
    page
      .getByRole("dialog", { name: "MPR prep" })
      .getByLabel("Text", { exact: true }),
  ).toHaveValue(/MPR preparation: Avery Stone/);
  await page.keyboard.press("Escape");
  await page.getByLabel("Cycle", { exact: true }).selectOption("2026-10-21");
  await expect(
    page.getByRole("table", { name: "Roster changes" }),
  ).toContainText("New hire");

  await page.keyboard.press("Control+k");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Copy EOD" })
    .click();
  await expect(page.getByRole("status").last()).toContainText("Report copied.");
  expect(await clipboard(page)).toContain("2026-11-25");
  clean();
});

test("settings: thresholds, staffing, layout, hours and theme", async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  const clean = await openTeam(page, "/settings");
  await expect(
    page.getByRole("heading", { name: "Flags and thresholds" }),
  ).toBeVisible();
  const lateness = page.getByLabel("Lateness incidents in a cycle");
  await expect(lateness).toHaveValue("3");
  await expect(
    page.locator(".setting").filter({ has: lateness }),
  ).toContainText("set by owner");
  const absent = page.getByLabel("NCNS/AWOL days in a cycle");
  await expect(absent).toHaveValue("");
  await expect(page.locator(".setting").filter({ has: absent })).toContainText(
    "not set",
  );
  await reviewScreen(page, info, "phase-8-settings");

  // Saving one form keeps what is being typed in another.
  await page.getByLabel("Callbacks", { exact: true }).fill("4");
  await lateness.fill("5");
  await page.getByRole("button", { name: "Save flags and thresholds" }).click();
  await expect(page.getByRole("status")).toContainText("Thresholds saved.");
  await expect(
    page.getByRole("link", { name: "Home, 1 urgent" }),
  ).toBeVisible();

  await page.getByLabel("…within the last days").fill("");
  await page.getByRole("button", { name: "Save flags and thresholds" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Set both missing days and its window",
  );

  await expect(page.getByLabel("Callbacks", { exact: true })).toHaveValue("4");
  await page.getByRole("button", { name: "Save staffing baselines" }).click();
  await expect(page.getByRole("status")).toContainText("Staffing");

  await page
    .getByLabel("Report layout", { exact: true })
    .fill("Agent\tLate\n{exception.name}\t{exception.late}");
  await page.getByRole("button", { name: "Save report layout" }).click();
  await expect(page.getByRole("status")).toContainText("Report layout saved.");
  await page.goto("/reports");
  await expect(page.getByText("Your layout")).toBeVisible();
  await expect(
    page.getByRole("table", { name: "End of day report" }).locator("thead th"),
  ).toHaveText(["Agent", "Late"]);

  await page.goto("/settings");
  await page.getByLabel("Choose attendance read hours here").check();
  await page.getByLabel("Read from").selectOption("6");
  await page
    .getByRole("button", { name: "Save cycle and attendance reads" })
    .click();
  await expect(page.getByRole("status")).toContainText("Cycle settings saved.");
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expectAccessible(page);
  clean();
});

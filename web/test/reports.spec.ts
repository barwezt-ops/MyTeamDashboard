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
  expect(await clipboard(page)).toContain("25 Nov 2026\tAgent");
  expect(await clipboard(page)).not.toContain("Avery");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export report as CSV" }).click();
  const csv = await readFile((await (await download).path())!, "utf8");
  expect(csv).toContain("Agent");
  expect(csv).not.toContain("Avery");

  // The attendance email: a subject waiting for its account, then the table.
  await expect(
    page.getByText("Attendance | {account} | 25 November 2026"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Copy subject" }),
  ).toBeDisabled();
  const email = page.getByRole("table", { name: "Attendance email table" });
  await expect(email.locator("tbody tr")).toHaveCount(2);
  await page.getByRole("button", { name: "Copy email table" }).click();
  await expect(page.getByRole("status").last()).toContainText(
    "email table copied",
  );
  const pasted = await page.evaluate(async () => {
    const [item] = await navigator.clipboard.read();
    return (await item.getType("text/html")).text();
  });
  expect(pasted).toMatch(/background-color:\s*(#16365c|rgb\(22, 54, 92\))/);
  expect(pasted).toMatch(/border:\s*1px solid/);
  expect(pasted).toContain("TL Comment");

  await page.getByLabel("Report date").fill("2026-11-23");
  await expect(eod).toContainText("23 Nov 2026");
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
  expect(await clipboard(page)).toContain("25 Nov 2026");
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
  await page.getByLabel("Account", { exact: true }).fill("Sample Account");
  await page.getByRole("button", { name: "Save attendance email" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Attendance email saved.",
  );
  await page
    .getByLabel("MPR layout", { exact: true })
    .fill("Sample review: {agent.name}");
  await page.getByRole("button", { name: "Save mpr layout" }).click();
  await expect(page.getByRole("status")).toContainText("MPR layout saved.");
  // The status map is read-only.
  await expect(
    page.getByText("Every status seen for your team is mapped."),
  ).toBeVisible();
  await expect(page.getByRole("table", { name: "Status map" })).toBeVisible();
  await page.goto("/reports");
  await expect(
    page.getByText("Attendance | Sample Account | 25 November 2026"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Copy subject" }).click();
  await expect
    .poll(() => clipboard(page))
    .toBe("Attendance | Sample Account | 25 November 2026");
  await page.getByLabel("Agent", { exact: true }).selectOption("99101");
  await page.getByRole("button", { name: "Open MPR prep" }).click();
  await expect(
    page
      .getByRole("dialog", { name: "MPR prep" })
      .getByLabel("Text", { exact: true }),
  ).toHaveValue("Sample review: Avery Stone");
  await page.keyboard.press("Escape");

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

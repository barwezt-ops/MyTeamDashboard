import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { openTeam, reviewScreen, teamUrl } from "./team";

test.use({ baseURL: teamUrl, timezoneId: "Africa/Cairo" });

test("coaching hub: overview, prep, log, follow-ups, history and fairness", async ({
  page,
}, info) => {
  test.setTimeout(150_000);
  const clean = await openTeam(page, "/coaching");
  await expect(
    page.getByRole("heading", { name: "Who needs it most" }),
  ).toBeVisible();
  const cards = page.locator(".agent-cards li");
  await expect(cards).toHaveCount(16);
  await expect(cards.first()).toContainText("open");
  await reviewScreen(page, info, "phase-6-coaching-overview");

  await page.getByRole("button", { name: "Prep Avery S." }).click();
  await expect(
    page.getByText("4 incidents, 38 minutes in total."),
  ).toBeVisible();
  await expect(
    page.getByText("Looking at these dates together, what do you notice?"),
  ).toBeVisible();
  await reviewScreen(page, info, "phase-6-coaching-prep");
  await page.getByRole("button", { name: "recognition" }).click();
  await expect(
    page.getByText("What are you most pleased with this cycle?"),
  ).toBeVisible();

  await page.getByRole("button", { name: "Log this coaching" }).click();
  await expect(page.getByLabel("Agent", { exact: true })).toHaveValue("99101");
  await reviewScreen(page, info, "phase-6-coaching-log");
  await page.getByLabel("What happened").fill("Synthetic coaching facts");
  await page.getByLabel("What was said").fill("Synthetic conversation");
  await page.getByLabel("Agreed next step").fill("Synthetic next step");
  await page.getByRole("button", { name: "Save coaching" }).click();
  await expect(page.getByRole("alert")).toContainText("at least one reason");
  await page.getByRole("checkbox", { name: "attendance" }).check();
  await page.getByRole("checkbox", { name: /^25 Nov: late 16m/ }).check();
  await page.getByLabel("Measure the next step by").selectOption("lateness");
  await page.getByRole("button", { name: "Save coaching" }).click();
  await expect(page.getByRole("alert")).toContainText("limit and a follow-up");
  await page.getByLabel("Follow-up date").fill("2026-12-03");
  await page.getByLabel("Most allowed until the follow-up").fill("0");
  await page.getByRole("checkbox", { name: "Agent acknowledged" }).check();
  await page.getByRole("button", { name: "Save coaching" }).click();
  await expect(page.getByRole("status")).toContainText("Coaching saved.");

  // History is filtered to the agent just coached.
  await expect(page).toHaveURL(/view=history&agent=99101/);
  await expect(page.locator(".timeline > li")).toHaveCount(2);
  await expect(
    page.getByRole("link", { name: "Coaching, 22 coachings due" }),
  ).toBeVisible();
  await reviewScreen(page, info, "phase-6-coaching-history");
  await page.getByRole("button", { name: "Copy as documentation" }).click();
  await expect(page.getByRole("status").last()).toContainText("copied");
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied.split(/\r?\n/)[0]).toBe(
    "Date\tWhat happened\tWhat was said\tAgreed next step\tFollow-up date",
  );
  expect(copied).toContain("Synthetic coaching facts");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  expect(await readFile((await (await download).path())!, "utf8")).toContain(
    "2026-12-03",
  );
  await page.getByLabel("Type").selectOption("recognition");
  await expect(
    page.getByText("No coaching matches these filters."),
  ).toBeVisible();

  await page.getByRole("link", { name: "Follow-ups" }).click();
  await reviewScreen(page, info, "phase-6-coaching-followups");
  await page
    .getByRole("button", { name: "Mark kept: Riley V., 26 Nov" })
    .click();
  await expect(
    page.getByRole("button", { name: "Reopen: Riley V., 26 Nov" }),
  ).toBeVisible();

  await page.getByRole("link", { name: "Fairness" }).click();
  await expect(
    page.getByRole("table", { name: "Coaching counts" }).locator("tbody tr"),
  ).toHaveCount(16);
  await reviewScreen(page, info, "phase-6-coaching-fairness");
  await page.getByRole("button", { name: "All time" }).click();
  await expect(page.getByRole("button", { name: "All time" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  clean();
});

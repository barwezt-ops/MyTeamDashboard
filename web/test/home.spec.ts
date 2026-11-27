import { expect, test } from "@playwright/test";
import { expectAccessible } from "./accessibility";
import { openTeam, reviewScreen, teamUrl } from "./team";

test.use({ baseURL: teamUrl, timezoneId: "Africa/Cairo" });

test("Home answers the shift questions from real numbers", async ({
  page,
}, info) => {
  test.setTimeout(90_000);
  const clean = await openTeam(page);
  await expect(
    page.getByRole("heading", { name: "Good afternoon, Alex." }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Two people need you before the 3:45 rush. Two more people have something due soon.",
    ),
  ).toBeVisible();
  await expect(
    page.getByText("Attendance & MTD through Wed 25 · QA synced 2h ago"),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Home, 2 urgent" }),
  ).toBeVisible();
  const urgent = page.getByRole("region", { name: "Urgent" });
  await expect(urgent).toContainText(
    "Avery S. reached 4 lateness incidents (flag at 3)",
  );
  await expect(
    page.getByRole("region", { name: "On the floor today" }),
  ).toContainText("/ 16");
  await expect(page.getByText("Late yesterday")).toBeVisible();
  await expect(
    page.getByText(/attendance today|today's attendance/i),
  ).toHaveCount(0);
  for (const title of [
    "Needs you",
    "The week",
    "Queues today",
    "Yesterday, in exceptions",
    "Lateness",
    "Worth a shout-out",
  ])
    await expect(
      page.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
  await reviewScreen(page, info, "phase-3-home");

  await page.getByRole("button", { name: "Copy for EOD" }).click();
  await expect(page.getByRole("status")).toContainText("Table copied.");
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied.split(/\r?\n/)[0]).toBe(
    "Date\tAgent\tQueue\tStatus\tLogin\tLate\tMissing\tBreak",
  );
  expect(copied).toContain("2026-11-25\tAvery S.\tInbound A\tPresent");
  await page.getByRole("button", { name: "Copy shout-out" }).click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toContain("No lateness, missing time or unplanned absence");

  await urgent.getByRole("button", { name: "Open both" }).click();
  await expect(
    page.getByRole("button", { name: /^Coach Avery S\./ }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/coaching\?view=prep&agent=99101/);
  await page.goto("/");
  await page.getByRole("button", { name: "Switch to dark theme" }).click();
  await expectAccessible(page);
  clean();
});

test("Home shows loading, error and retry states", async ({ page }) => {
  let fail = true;
  await page.route("**/api/v2/home", (route) =>
    fail
      ? route.fulfill({
          status: 503,
          json: { error: "Fixture connection interrupted" },
        })
      : route.continue(),
  );
  await openTeam(page);
  await expect(page.getByRole("alert")).toContainText(
    "Fixture connection interrupted",
  );
  await expectAccessible(page);
  fail = false;
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Needs you", exact: true }),
  ).toBeVisible();
});

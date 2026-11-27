import { expect, test } from "@playwright/test";
import { expectAccessible } from "./accessibility";
import { openTeam, reviewScreen, teamUrl } from "./team";

test.use({ baseURL: teamUrl, timezoneId: "Africa/Cairo" });

test("agent profile: facts, documents, notes, follow-ups and dismissal", async ({
  page,
}, info) => {
  test.setTimeout(90_000);
  const clean = await openTeam(page, "/agent/99103");
  await expect(
    page.getByRole("heading", { name: "Riley", exact: true }),
  ).toBeVisible();
  for (const title of [
    "Open flags",
    "Cycle scorecard",
    "This cycle, day by day",
    "Last 6 cycles",
    "Patterns",
    "Coaching timeline",
    "Private notes",
    "Discrepancy history",
  ])
    await expect(
      page.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
  await reviewScreen(page, info, "phase-5-profile");

  await page.getByRole("button", { name: /^25 Nov: / }).click();
  await expect(page.locator(".day-card")).toContainText("Login");

  await page.getByRole("button", { name: "MPR prep" }).click();
  const mpr = page.getByRole("dialog", { name: "MPR prep" });
  await expect(mpr.getByLabel("Text", { exact: true })).toHaveValue(
    /MPR preparation: Riley Vale \(99103\)/,
  );
  await expectAccessible(page);
  await mpr.getByRole("button", { name: "Copy" }).click();
  await expect(mpr.getByRole("status")).toHaveText("Copied.");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Draft escalation" }).click();
  await expect(
    page
      .getByRole("dialog", { name: "Escalation draft" })
      .getByLabel("Text", { exact: true }),
  ).toHaveValue(/What I've already done[\s\S]*What I need/);
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "New note" }).click();
  const note = page.getByRole("dialog", { name: "Add private note" });
  await note.getByLabel("Note", { exact: true }).fill("Synthetic private note");
  await note.getByLabel("Tags, separated by commas").fill("one, two, one");
  await expectAccessible(page);
  await note.getByRole("button", { name: "Save note" }).click();
  await expect(page.getByText("Synthetic private note")).toBeVisible();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const edit = page.getByRole("dialog", { name: "Edit private note" });
  await edit.getByLabel("Note", { exact: true }).fill("Edited private note");
  await edit.getByRole("button", { name: "Save note" }).click();
  await expect(page.getByText("Edited private note")).toBeVisible();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("button", { name: "Confirm delete" }).click();
  await expect(page.getByText("No private notes.")).toBeVisible();

  const dismiss = page.getByRole("button", {
    name: "Dismiss: Follow-up due today",
  });
  await dismiss.click();
  const reason = page.getByRole("dialog", { name: "Dismiss flag" });
  await reason.getByLabel("Reason").fill("Reviewed in person");
  await reason.getByRole("button", { name: "Dismiss", exact: true }).click();
  await expect(dismiss).toHaveCount(0);
  await expect(page.getByText("Dismissed flags (1)")).toBeVisible();

  await page
    .getByRole("button", { name: "Mark the 19 Nov follow-up kept" })
    .click();
  await expect(page.getByText("Marked kept by you.")).toBeVisible();
  clean();
});

test("agent profile opens in a drawer and reports unknown agents", async ({
  page,
}) => {
  const clean = await openTeam(page);
  await page.getByRole("button", { name: "Open Avery S." }).first().click();
  const drawer = page.getByRole("dialog", { name: "Agent profile" });
  await expect(
    drawer.getByRole("heading", { name: "Avery Stone" }),
  ).toBeVisible();
  await drawer.getByRole("button", { name: "New note" }).click();
  const note = page.getByRole("dialog", { name: "Add private note" });
  await note.getByLabel("Note", { exact: true }).fill("Drawer note");
  await note.getByRole("button", { name: "Save note" }).click();
  await expect(drawer.getByRole("status").last()).toContainText("Note saved.");
  await expectAccessible(page);
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  clean();
  await page.goto("/agent/00000");
  await expect(page.getByRole("alert")).toContainText(
    "Agent in your team not found",
  );
});

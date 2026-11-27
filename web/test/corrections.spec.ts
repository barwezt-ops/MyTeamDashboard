import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { openTeam, reviewScreen } from "./team";
import { expectAccessible } from "./accessibility";

test.use({ baseURL: "http://127.0.0.1:3213", timezoneId: "Africa/Cairo" });

test("waivers retain WFM minutes in grid, Home, profile and Settings", async ({
  page,
}) => {
  test.setTimeout(90000);
  const clean = await openTeam(page, "/attendance", "/waivers-fixture");
  await page.getByRole("button", { name: /25 Nov:.*TL waiver/ }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "16m late · waived per TL comment",
  );
  await expect(page.getByRole("dialog")).toContainText(
    "32m missing · waived per TL comment",
  );
  await page.keyboard.press("Escape");
  await page.goto("/");
  await expect(
    page.getByRole("table", { name: "Yesterday, in exceptions" }),
  ).toContainText("16m late · waived per TL comment");
  await page.goto("/agent/99103");
  await page.getByRole("button", { name: /25 Nov:.*TL waiver/ }).click();
  await expect(page.locator(".day-card")).toContainText(
    "32m missing · waived per TL comment",
  );
  await page.goto("/settings");
  const table = page.getByRole("table", { name: "Corrections", exact: true });
  await expect(table).toContainText("16m late · waived per TL comment");
  await expect(table).toContainText("32m missing · waived per TL comment");
  await expectAccessible(page);
  clean();
});

test("sheet corrections across grid, Home, profile and Settings; app wins and undo returns to sheet", async ({
  page,
}, info) => {
  test.setTimeout(120000);
  const clean = await openTeam(page, "/attendance", "/corrections-fixture");
  const label = "NCNS → Forced Annual · TL comment";
  const corrected = page
    .locator(".attendance-grid button")
    .filter({ has: page.locator(".correction-mark") })
    .filter({ hasText: "*" });
  await expect(corrected).toHaveCount(1);
  await corrected.click();
  const drawer = page.getByRole("dialog");
  await expect(drawer).toContainText(label);
  await expect(drawer).toContainText("Forced Annual approved for this day.");
  await expectAccessible(page);
  await page.screenshot({
    path: process.env.SAVE_SCREENSHOTS
      ? "docs/design/corrections-grid-1440.png"
      : info.outputPath("corrected-grid.png"),
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  const csv = await readFile((await (await download).path())!, "utf8");
  expect(csv).toContain(label);
  expect(csv).not.toContain("approved for this day");
  expect(csv).not.toContain("Transport delay");
  await page.goto("/");
  await expect(
    page.getByRole("table", { name: "Yesterday, in exceptions" }),
  ).toContainText(label);
  await reviewScreen(page, info, "corrections-home");
  await page.goto("/agent/99105");
  await page
    .getByRole("button", { name: new RegExp("25 Nov:.*NCNS → Forced Annual") })
    .click();
  await expect(page.locator(".day-card")).toContainText(label);
  await reviewScreen(page, info, "corrections-profile");
  await page.goto("/attendance");
  await corrected.click();
  await drawer
    .getByRole("button", { name: "Correct status", exact: true })
    .click();
  await drawer
    .getByLabel("Correct status", { exact: true })
    .selectOption("sick");
  await drawer
    .getByLabel("Correction note")
    .fill("Synthetic owner note kept locally.");
  await drawer.getByRole("button", { name: "Save correction" }).click();
  await expect(drawer).toHaveCount(0);
  await page.goto("/settings");
  const table = page.getByRole("table", { name: "Corrections", exact: true });
  await expect(table).toContainText("NCNS → Sick · App correction");
  await expect(table).toContainText("Transport delay reported to the lead.");
  await expect(table).toContainText(
    "names more than one status, not corrected",
  );
  await table.getByRole("button", { name: "Undo correction" }).click();
  await expect(table).toContainText(label);
  await expect(table).not.toContainText("Synthetic owner note");
  await page.goto("/attendance");
  await page.getByRole("button", { name: /22 Nov:.*Explained/ }).click();
  await expect(drawer).toContainText(
    "names more than one status, not corrected",
  );
  await page.keyboard.press("Escape");
  await corrected.click();
  await expect(drawer).toContainText(label);
  clean();
});

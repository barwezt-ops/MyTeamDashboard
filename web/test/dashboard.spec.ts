import { expect, test } from "@playwright/test";

test("sign in, review views, add an agent note, and copy the email table", async ({
  page,
  request,
}, testInfo) => {
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  page.on("console", (event) => {
    if (event.type() === "error" && !event.text().includes("401"))
      consoleErrors.push(event.text());
  });
  const screenshot = (name: string) =>
    page.screenshot({
      path: testInfo.outputPath(name + ".png"),
      fullPage: true,
      animations: "disabled",
    });
  const theme = (dark: boolean) =>
    page
      .getByRole("button", {
        name: dark ? "Switch to light theme" : "Switch to dark theme",
      })
      .click();
  expect((await request.get("/api/agents")).status()).toBe(401);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Team Dashboard" }),
  ).toBeVisible();
  await screenshot("login-light");
  await theme(false);
  await screenshot("login-dark");
  await theme(true);
  await page.getByLabel("Password").fill("synthetic-smoke-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
  await expect(page.getByRole("table", { name: "Agents" })).toBeVisible();
  await expect(
    page
      .locator(".stat")
      .filter({ hasText: "Not on schedule" })
      .locator("strong"),
  ).toHaveText("1");
  await expect(
    page.locator(".stat").filter({ hasText: "Unknown" }).locator("strong"),
  ).toHaveText("1");
  await expect(
    page
      .getByRole("row", { name: /Morgan/ })
      .getByText("Not on schedule", { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("row", { name: /Riley/ })
      .getByText("Unknown", { exact: true }),
  ).toBeVisible();
  await screenshot("today-light");
  await theme(false);
  await screenshot("today-dark");
  await theme(true);
  await page
    .getByRole("table", { name: "Agents" })
    .getByRole("button", { name: "Avery" })
    .click();
  const agent = page.getByRole("dialog", { name: "Agent profile" });
  await expect(agent.getByText("Avery Sample")).toBeVisible();
  await agent.getByRole("button", { name: "Add note" }).click();
  await agent.getByLabel("What happened").fill("Sample follow-up");
  await agent
    .getByLabel("What was said")
    .fill("Synthetic note for smoke testing.");
  await agent.getByLabel("Agreed next step").fill("Confirm next shift");
  await agent.getByLabel("Follow-up date").fill("2026-11-21");
  await agent.getByRole("button", { name: "Save note" }).click();
  await expect(
    agent.getByText("Sample follow-up", { exact: true }),
  ).toBeVisible();
  await agent.getByRole("link", { name: "Full profile" }).click();
  await expect(page.getByRole("heading", { name: "Avery" })).toBeVisible();
  await screenshot("agent-light");
  await theme(false);
  await screenshot("agent-dark");
  await theme(true);
  const navigation = page.getByRole("navigation", { name: "Dashboard" });
  for (const [view, heading] of [
    ["Discrepancies", "Review queue"],
    ["Trends", "Status by day"],
    ["Roster", "Team list"],
    ["Settings", "Sync log"],
  ]) {
    await navigation.getByRole("link", { name: view, exact: true }).click();
    await expect(
      page.getByRole("heading", { name: heading, exact: true }),
    ).toBeVisible();
    if (view === "Discrepancies") {
      const copy = page.getByRole("button", { name: "Copy as email table" });
      await expect(copy).toBeEnabled();
      await copy.click();
      await expect(page.getByText("Table copied.")).toBeVisible();
      const clipboard = await page.evaluate(async () => {
        const items = await navigator.clipboard.read();
        const item = items[0];
        return {
          html: await (await item.getType("text/html")).text(),
          plain: await (await item.getType("text/plain")).text(),
        };
      });
      expect(clipboard.html).toMatch(
        /background-color:\s*(#16365c|rgb\(22, 54, 92\))/,
      );
      expect(clipboard.html).toMatch(/border:\s*1px solid/);
      expect(clipboard.plain).toContain(
        "Code\tName\tTeam Leader\tAccount\tDate\tMissing\tTL Comment",
      );
    }
    await screenshot(view.toLowerCase() + "-light");
    await theme(false);
    await screenshot(view.toLowerCase() + "-dark");
    await theme(true);
  }
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  expect(consoleErrors).toEqual([]);
});

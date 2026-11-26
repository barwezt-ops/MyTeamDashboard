import { expect, test } from "@playwright/test";
import type { DashboardData } from "../../server/src/v2/data";

test("V2 authenticated data, owner records, validation and backup inclusion", async ({
  page,
}, info) => {
  await page.goto("/");
  expect((await page.request.get("/api/v2/data")).status()).toBe(401);
  await page.getByLabel("Password").fill("synthetic-smoke-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator(".sidebar")).toBeVisible();
  const read = async () =>
    (await (await page.request.get("/api/v2/data")).json()) as DashboardData;
  const before = await read();
  expect(before.agents.every((a) => a.ownerGroup === "mine")).toBe(true);
  expect(before.agents.find((a) => a.code === "99001")?.line).toBe(
    "Sample inbound",
  );
  expect(before.settings).toMatchObject({
    latenessIncidents: 3,
    missingMinutes: null,
    qaBelow: null,
    absentDays: null,
  });
  expect(before.qaConnected).toBe(false);
  const created = await page.request.post("/api/v2/coachings", {
    data: {
      code: "99001",
      date: "2026-11-21",
      type: "recognition",
      reasons: ["recognition"],
      evidence: [],
      whatHappened: "Synthetic facts",
      whatWasSaid: "Synthetic conversation",
      nextStep: "Review next shift",
      followUpDate: "2026-11-21",
      acknowledged: true,
    },
  });
  expect(created.status()).toBe(201);
  const after = await read();
  expect(after.agents.find((a) => a.code === "99001")!.coachingDone).toBe(
    before.agents.find((a) => a.code === "99001")!.coachingDone + 1,
  );
  const followUp = after.agents
    .find((a) => a.code === "99001")!
    .followUps.at(-1)!;
  expect(
    (
      await page.request.patch(`/api/v2/followups/${followUp.id}`, {
        data: { state: "kept" },
      })
    ).status(),
  ).toBe(204);
  expect(
    (
      await page.request.patch("/api/v2/settings", {
        data: { missingDays: 2 },
      })
    ).status(),
  ).toBe(400);
  const backup = await (await page.request.get("/api/backup")).json();
  expect(
    backup.owner.coachings.some(
      (c: { what_happened: string }) => c.what_happened === "Synthetic facts",
    ),
  ).toBe(true);
  expect(backup.owner.lineHistory.length).toBeGreaterThan(0);
  expect(
    (await page.request.post("/api/v2/coachings", { data: {} })).status(),
  ).toBe(400);
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Backups" })).toBeVisible();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.screenshot({
      path: info.outputPath(`data-settings-${width}.png`),
      fullPage: true,
    });
  }
});

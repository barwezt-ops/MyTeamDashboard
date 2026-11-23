import { expect, it } from "vitest";
import { calculateTrends } from "../src/api/trends.js";
import { exportDiscrepancies } from "../src/api/export.js";
import { sampleMaster, today } from "./sample.js";
import type { DiscrepancyRow, ScheduleDay } from "../src/api/dto.js";
const prior = "2026-11-20";

it("uses one effective status per agent date and bases thresholds on the configured rolling window", () => {
  const { agents } = sampleMaster();
  const schedule: ScheduleDay[] = [
    {
      code: "99001",
      date: prior,
      status: "Casual",
      raw: "Casual",
      shiftStart: null,
    },
    {
      code: "99001",
      date: today,
      status: "Scheduled",
      raw: "15:45",
      shiftStart: "15:45",
    },
    {
      code: "99002",
      date: today,
      status: "Off Day",
      raw: "OFF",
      shiftStart: null,
    },
  ];
  const attendance = [
    {
      code: "99001",
      date: today,
      status: "Casual" as const,
      raw: "Casual",
      missing: null,
    },
    {
      code: "99002",
      date: today,
      status: "Absent" as const,
      raw: "Absent",
      missing: null,
    },
  ];
  const report = calculateTrends(
    agents,
    schedule,
    attendance,
    [],
    today,
    today,
    today,
    { Casual: { count: 2, days: 2 } },
  );
  expect(report.totals).toMatchObject({ Casual: 1, "Off Day": 1, Absent: 0 });
  expect(report.daily[0]).toMatchObject({
    Scheduled: 0,
    Casual: 1,
    "Off Day": 1,
  });
  expect(report.agents[0].badges).toEqual([
    { status: "Casual", count: 2, days: 2 },
  ]);
});

it("creates the standard email table and escapes cell contents", () => {
  const row: DiscrepancyRow = {
    id: "x",
    date: today,
    code: "99001",
    firstName: "Avery",
    tl: "Sample Lead",
    account: "Support",
    ruleId: "D4",
    severity: "action",
    source: "attendance",
    missing: "<missing>",
    state: "open",
    tlComment: "checked & logged",
    createdAt: today,
    updatedAt: today,
  };
  const { html, tsv } = exportDiscrepancies([row]);
  expect(html).toContain(
    "background-color:#16365c;color:#fff;font-weight:bold",
  );
  expect(html).toContain("border:1px solid #000");
  expect(html).toContain("&lt;missing&gt;");
  expect(tsv.split("\n")[0]).toBe(
    "Code\tName\tTeam Leader\tAccount\tDate\tMissing\tTL Comment",
  );
});

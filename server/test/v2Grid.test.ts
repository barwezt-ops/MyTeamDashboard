import { afterAll, expect, it } from "vitest";
import { openDb } from "../src/db/db.js";
import { dashboardData } from "../src/v2/data.js";
import { gridView } from "../src/v2/grid.js";
import { teamView } from "../src/v2/team.js";
import { seedTeam, teamConfig, TEAM_TODAY } from "../../fixtures/team.js";

const teamViewColumns = [
  "Code",
  "Name",
  "Team Leader",
  "HR Status",
  "Latest Day",
  "Status (Latest Day)",
  "Scheduled Shift",
  "Login",
  "Logout",
  "Lateness (Latest Day)",
  "Missing (Latest Day)",
  "Break Exceeded (Latest Day)",
  "NCNS Streak",
  "Days Late (Cycle)",
  "Days With Missing (Cycle)",
  "Breaks Exceeded (Cycle)",
  "MTD Missing Hours",
  "MTD OT Hours",
  "MTD Lateness Mins",
  "MTD Lateness Incidents",
  "MTD Sick",
  "MTD UPL",
  "MTD Casual",
  "MTD Annual",
  "MTD NCNS",
  "MTD AWOL",
  "MTD Deducted Days",
];
const db = openDb(":memory:");
seedTeam(db);
const config = teamConfig();
const load = (asOf = TEAM_TODAY) => dashboardData(db, config, TEAM_TODAY, asOf);
afterAll(() => db.close());

it("lays out every day of the cycle with plan outlines and totals", () => {
  const view = gridView(load());
  expect(view.cycle).toEqual({ from: "2026-11-21", to: "2026-12-20" });
  expect(view.days).toHaveLength(30);
  expect(view.rows).toHaveLength(16);
  expect(view.days.filter((day) => day.yesterday).map((d) => d.date)).toEqual([
    "2026-11-25",
  ]);
  const avery = view.rows.find((row) => row.code === "99101")!;
  expect(avery.totals).toMatchObject({
    lateCount: 4,
    lateMinutes: 38,
    missingMinutes: 0,
    NCNS: 0,
    breaks: 0,
  });
  const cell = (code: string, date: string) =>
    view.rows
      .find((row) => row.code === code)!
      .cells.find((item) => item.date === date)!;
  expect(cell("99101", "2026-11-25")).toMatchObject({
    status: "Late",
    planned: false,
    late: 16,
  });
  expect(cell("99101", "2026-11-25").details).toContainEqual(["Late", "16m"]);
  expect(cell("99111", "2026-11-27")).toMatchObject({
    status: "Leave / sick",
    planned: true,
  });
  expect(cell("99101", "2026-12-01").planned).toBe(true);
  expect(cell("99101", "2026-12-01").details.at(-1)).toEqual([
    "Attendance",
    "Not reported yet",
  ]);
  const yesterday = view.days.find((day) => day.date === "2026-11-25")!;
  expect(yesterday.late).toBe(3);
  expect(yesterday.present).toBe(
    view.rows.filter((row) =>
      row.cells.some(
        (item) =>
          item.date === "2026-11-25" &&
          item.details.some(([, value]) => value === "Active - Site"),
      ),
    ).length,
  );
  expect(view.summary).toMatch(
    /^8 late days, 70 minutes in total; \d+ days? with missing time\.$/,
  );
});

it("shows a past cycle from its recorded days", () => {
  const view = gridView(load("2026-10-21"));
  expect(view.cycle).toEqual({ from: "2026-10-21", to: "2026-11-20" });
  expect(view.days).toHaveLength(31);
  expect(view.days.every((day) => day.reported)).toBe(true);
  expect(view.rows[0].cells.every((cell) => !cell.planned)).toBe(true);
});

it("compares each agent with the same point of the previous cycle", () => {
  const current = load();
  const view = teamView(current, load(current.prior.from));
  expect(view.comparison).toBe(
    "Changes compare with the first 5 days of the previous cycle.",
  );
  const avery = view.rows.find((row) => row.code === "99101")!;
  expect(avery.values).toMatchObject({
    name: "Avery Stone",
    line: "Inbound A",
    lateCount: 4,
    lateMinutes: 38,
    coaching: "0/2",
  });
  expect(avery.deltas.lateCount).toBe(4);
  expect(avery.urgent).toBe(true);
  expect(view.columns.map((column) => column.key)).toEqual(
    expect.arrayContaining([
      "lateCount",
      "missingMinutes",
      "otMinutes",
      "deductedDays",
      "qa",
      "coaching",
      "flags",
    ]),
  );
  // Every Team View column is offered, under the sheet's own label.
  const labels = view.columns.map((column) => column.label);
  expect(labels).toEqual(expect.arrayContaining(teamViewColumns));
  expect(new Set(labels).size).toBe(labels.length);
  expect(avery.values).toMatchObject({
    teamLeader: "Sample Lead",
    latestDay: "2026-11-25",
    latestStatus: "Active - Site",
    latestShift: "15:45",
    latestLate: 16,
    latestMissing: 0,
    latestBreak: null,
    ncnsStreak: 0,
    daysLate: 4,
    daysMissing: 0,
    mtdLateness: 38,
    mtdIncidents: 4,
    "mtd:sick": null,
  });
  expect(view.rows.find((row) => row.code === "99104")!.values).toMatchObject({
    latestBreak: 76,
    breaks: 3,
    breakMinutes: 89,
  });
  // Missing values stay missing, and no change is reported for them.
  expect(avery.values.otMinutes).toBe(0);
  const past = load("2026-10-21");
  expect(teamView(past, load(past.prior.from)).comparison).toBe(
    "Changes compare with all of the previous cycle.",
  );
});

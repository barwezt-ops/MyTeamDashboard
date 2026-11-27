import { afterAll, expect, it, vi } from "vitest";
import { openDb } from "../src/db/db.js";
import { eventsOf } from "../src/db/repo.js";
import { startLiveJobs } from "../src/sync/cron.js";
import { dashboardData } from "../src/v2/data.js";
import { cycleSummary, eodReport, rosterReport } from "../src/v2/reports.js";
import {
  readSettings,
  saveSettings,
  settingsSchema,
} from "../src/v2/settings.js";
import { defaultTemplate, renderTemplate } from "../src/v2/template.js";
import { seedTeam, teamConfig, TEAM_TODAY } from "../../fixtures/team.js";

const db = openDb(":memory:");
seedTeam(db);
const config = teamConfig();
const load = (date = TEAM_TODAY) => dashboardData(db, config, TEAM_TODAY, date);
afterAll(() => db.close());

it("fills the default layout with yesterday's exceptions", () => {
  const report = eodReport(load(), "2026-11-25");
  expect(report).toMatchObject({
    reported: true,
    customTemplate: false,
    exceptions: 6,
    unknown: [],
  });
  expect(report.table!.headers).toEqual(
    defaultTemplate.split("\n")[0].split("\t"),
  );
  expect(report.table!.rows).toHaveLength(6);
  expect(report.table!.rows[0].slice(0, 7)).toEqual([
    "2026-11-25",
    "Avery S.",
    "Inbound A",
    "Present",
    "3:46 PM",
    "16m",
    "",
  ]);
});

it("repeats the owner's row lines and reports unknown placeholders", () => {
  saveSettings(db, {
    ...readSettings(db),
    reportTemplate: [
      "Attendance for {date.long}",
      "Present {team.present} of {team.size}, late {team.late} ({team.late_minutes} min)",
      "{row.code}: {row.status} {row.nonsense}",
      "{made.up}",
    ].join("\n"),
  });
  const report = eodReport(load(), "2026-11-25");
  const lines = report.text.split("\n");
  expect(lines[0]).toBe("Attendance for Wednesday 25 November");
  expect(lines[1]).toMatch(/^Present 12 of \d+, late 3 \(31 min\)$/);
  expect(lines.filter((line) => /^991\d\d:/.test(line))).toHaveLength(16);
  expect(report.unknown).toEqual(["{row.nonsense}", "{made.up}"]);
  expect(report.table).toBeNull();
  const none = renderTemplate(
    "Name\tLate\n{exception.name}\t{exception.late}",
    {} as never,
    { row: [], exception: [] },
  );
  expect(none.table).toEqual({ headers: ["Name", "Late"], rows: [] });
  const unsafe = renderTemplate("{row.name}\tx", {} as never, {
    row: [{ name: "=cmd\t\nx" } as never],
    exception: [],
  });
  expect(unsafe.text).toBe("'=cmd x\tx");
});

it("summarises the cycle and lists roster changes", () => {
  const summary = cycleSummary(load());
  expect(summary.text).toContain(
    "Cycle summary 21 Nov to 20 Dec 2026, results through 25 Nov",
  );
  expect(summary.text).toContain("Lateness: 8 incidents, 1h 10m");
  expect(summary.text).toContain("Coaching: 9 of 32");
  expect(summary.table.rows).toHaveLength(16);
  const previous = load("2026-10-21");
  db.prepare(
    "UPDATE attendance_mtd_snapshots SET fields=json_set(fields,'$.status','Dropped') WHERE code='99116'",
  ).run();
  expect(
    rosterReport(previous, eventsOf(db, previous.cycle.from)).rows,
  ).toContainEqual([
    "2026-10-25",
    "99115",
    "Skyler Cross",
    "New hire",
    "Joined the team",
  ]);
  expect(rosterReport(load(), eventsOf(db, "2026-11-21")).rows).toContainEqual([
    TEAM_TODAY,
    "99116",
    "Finley Hale",
    "Dropped",
    "MTD status",
  ]);
});

it("reads attendance during the hours chosen in Settings", () => {
  expect(
    settingsSchema.safeParse({ attendanceHours: { start: 3, end: 3 } }).success,
  ).toBe(false);
  const paste = teamConfig();
  paste.sources.attendance = {
    ...paste.sources.attendance,
    access: "google",
    enabled: true,
    paste: { sheetId: "FakePaste", startHour: 0, endHour: 24 },
  };
  const own = openDb(":memory:");
  const start = vi.fn(() => Promise.resolve(true));
  const now = new Date("2026-11-26T12:30:00Z"); // 14:30 in Cairo
  own
    .prepare(
      "INSERT INTO sync_log(job,started_at,finished_at,ok) VALUES ('roster',?,?,1),('daily',?,?,1)",
    )
    .run(...Array(4).fill(now.toISOString()));
  const jobs = startLiveJobs(
    own,
    ":memory:",
    paste,
    { active: null, start } as never,
    () => now,
  );
  try {
    saveSettings(own, {
      ...readSettings(own),
      attendanceHours: { start: 16, end: 20 },
    });
    jobs.check();
    expect(start).not.toHaveBeenCalledWith("attendance");
    saveSettings(own, {
      ...readSettings(own),
      attendanceHours: { start: 12, end: 15 },
    });
    jobs.check();
    expect(start).toHaveBeenCalledWith("attendance");
  } finally {
    jobs.stop();
    own.close();
  }
});

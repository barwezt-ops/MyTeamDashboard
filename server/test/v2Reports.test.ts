import { afterAll, expect, it, vi } from "vitest";
import { openDb } from "../src/db/db.js";
import { eventsOf } from "../src/db/repo.js";
import { startLiveJobs } from "../src/sync/cron.js";
import { dashboardData } from "../src/v2/data.js";
import {
  attendanceEmail,
  cycleSummary,
  eodReport,
  rosterReport,
} from "../src/v2/reports.js";
import { statusMapView } from "../src/v2/statusMap.js";
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
    "25 Nov 2026",
    "Agent",
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

it("never puts an agent's name in the end-of-day report", () => {
  saveSettings(db, {
    ...readSettings(db),
    reportTemplate: [
      "{team.late_agents} late, {team.missing_agents} missing time",
      "{team.exception_agents} with an exception, {team.break_agents} over a break",
      "{row.name}\t{row.full_name}",
      "{exception.name}\t{exception.full_name}",
    ].join("\n"),
  });
  const data = load();
  const report = eodReport(data, "2026-11-25");
  expect(report.text.split("\n").slice(0, 2)).toEqual([
    "3 Agents late, 2 Agents missing time",
    "6 Agents with an exception, 3 Agents over a break",
  ]);
  const everything = report.text + JSON.stringify(report.table);
  for (const agent of data.agents)
    for (const name of [agent.fullName, ...agent.fullName.split(" ")])
      expect(everything).not.toContain(name);
  expect(report.text).toContain("Agent\tAgent");
  // One person reads in the singular. The default layout has no names either.
  saveSettings(db, {
    ...readSettings(db),
    reportTemplate: "{team.late_agents}",
  });
  expect(eodReport(load(), "2026-11-21").text).toBe("1 Agent");
  saveSettings(db, { ...readSettings(db), reportTemplate: "" });
  expect(eodReport(load(), "2026-11-25").text).not.toMatch(/Avery|Jordan/);
});

it("builds the attendance email from recorded missing time", () => {
  const before = attendanceEmail(load(), "2026-11-25");
  expect(before.table).toEqual({
    headers: [
      "Code",
      "Name",
      "Team Leader",
      "Account",
      "Date",
      "Missing",
      "TL Comment",
    ],
    rows: [
      [
        "99102",
        "Jordan Brook",
        "Sample Lead",
        "Support",
        "25 Nov 2026",
        "32m",
        "",
      ],
      [
        "99103",
        "Riley Vale",
        "Sample Lead",
        "Support",
        "25 Nov 2026",
        "8m",
        "",
      ],
    ],
  });
  // The subject waits for the account the owner sets.
  expect(before).toMatchObject({
    subject: "Attendance | {account} | 25 November 2026",
    needsAccount: true,
  });
  saveSettings(db, { ...readSettings(db), reportAccount: "Sample $& Account" });
  expect(attendanceEmail(load(), "2026-11-25")).toMatchObject({
    subject: "Attendance | Sample $& Account | 25 November 2026",
    needsAccount: false,
  });
  saveSettings(db, {
    ...readSettings(db),
    emailSubject: "{D Month YYYY} missing time",
  });
  expect(attendanceEmail(load(), "2026-11-25").subject).toBe(
    "25 November 2026 missing time",
  );
  expect(attendanceEmail(load(), "2026-11-26").table.rows).toEqual([]);
});

it("lists statuses seen for the team that the map does not cover", () => {
  expect(statusMapView(db, config).unmapped).toEqual([]);
  db.prepare(
    "UPDATE attendance_days SET raw='Sample Leave',status='Unknown' WHERE code='99101' AND date IN ('2026-11-23','2026-11-24')",
  ).run();
  db.prepare(
    "UPDATE schedule_days SET raw=' sample  leave ',status='Unknown' WHERE code='99102' AND date='2026-11-27'",
  ).run();
  // A label mapped since the last sync is no longer listed.
  db.prepare(
    "UPDATE schedule_days SET raw='OFF',status='Unknown' WHERE code='99102' AND date='2026-11-28'",
  ).run();
  expect(statusMapView(db, config).unmapped).toEqual([
    {
      label: "sample  leave",
      source: "Schedule",
      count: 1,
      last: "2026-11-27",
    },
    {
      label: "Sample Leave",
      source: "Attendance",
      count: 2,
      last: "2026-11-24",
    },
  ]);
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
    "25 Oct 2026",
    "99115",
    "Skyler Cross",
    "New hire",
    "Joined the team",
  ]);
  expect(rosterReport(load(), eventsOf(db, "2026-11-21")).rows).toContainEqual([
    "26 Nov 2026",
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

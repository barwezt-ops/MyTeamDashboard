import { afterAll, afterEach, expect, it, vi } from "vitest";
import { openDb } from "../src/db/db.js";
import {
  agentsOf,
  attendanceOf,
  discrepanciesOf,
  scheduleOf,
} from "../src/db/repo.js";
import { calculateTrends } from "../src/api/trends.js";
import { attendanceLabel } from "../src/db/corrections.js";
import { commentStatus } from "../src/parse/commentStatus.js";
import { attendancePasteStatusMap } from "../src/parse/status.js";
import {
  prepareAttendancePaste,
  storeAttendancePaste,
  attendancePastePreview,
} from "../src/sync/attendancePaste.js";
import { refreshAttendanceRules } from "../src/rules/index.js";
import { dashboardData } from "../src/v2/data.js";
import { homeView } from "../src/v2/home.js";
import { gridView } from "../src/v2/grid.js";
import { profileView } from "../src/v2/profile.js";
import { prepView } from "../src/v2/coaching.js";
import { attendanceEmail, cycleSummary, eodReport } from "../src/v2/reports.js";
import { escalationText, mprText } from "../src/v2/documents.js";
import { teamView } from "../src/v2/team.js";
import { exportBackup } from "../src/backup/data.js";
import { exportDiscrepancies } from "../src/api/export.js";
import {
  fakePaste,
  fixtureConfig,
  seedAgents,
  type FakeDay,
} from "../../fixtures/v2.js";
import { readSettings, saveSettings } from "../src/v2/settings.js";

const db = openDb(":memory:");
const config = fixtureConfig();
const date = "2026-11-25",
  today = "2026-11-26",
  code = "99001";
const privateText = "Synthetic private reason";
const load = () => dashboardData(db, config, today);
afterAll(() => db.close());
function paste(note: string, status = "NCNS", values: Partial<FakeDay> = {}) {
  const input = fakePaste([
    { code, date: "2026-11-24" },
    { code, date, status, missing: 60, tlComment: note, ...values },
  ]);
  input.mtd[0] = {
    ...input.mtd[0],
    "count:ncns": status === "NCNS" ? 1 : 0,
    "count:forced annual": status === "Forced Annual" ? 1 : 0,
  } as (typeof input.mtd)[number];
  const prepared = prepareAttendancePaste(
    input.attendance,
    input.mtd,
    config,
    agentsOf(db),
  );
  storeAttendancePaste(db, prepared, today, today + "T09:00:00Z", 21);
  refreshAttendanceRules(db, today, true);
  return prepared;
}
afterEach(() => {
  for (const table of [
    "agents",
    "attendance_days",
    "attendance_paste_details",
    "attendance_sheet_comments",
    "attendance_corrections",
    "attendance_mtd_snapshots",
    "attendance_paste_state",
    "schedule_days",
    "discrepancies",
    "owner_settings",
  ])
    db.prepare(`DELETE FROM ${table}`).run();
  vi.restoreAllMocks();
});
function seed() {
  seedAgents(db, [[code, "Avery Sample"]]);
  config.sources.attendance.enabled = true;
  db.prepare(
    "INSERT INTO schedule_days VALUES (?,?,'09:00','Scheduled','09:00',?)",
  ).run(code, date, today);
  saveSettings(db, {
    ...readSettings(db),
    absentDays: 1,
    missingMinutes: 30,
    latenessIncidents: 1,
    breakConsecutive: 1,
  });
}

it("keeps previews compatible with an unmigrated installed database", () => {
  const legacy = openDb(":memory:");
  try {
    legacy.exec(
      "DROP TABLE attendance_corrections; DROP TABLE attendance_sheet_comments",
    );
    legacy
      .prepare(
        "INSERT INTO attendance_days VALUES (?,?,'NCNS','Absent',NULL,?)",
      )
      .run(code, date, today);
    expect(attendanceOf(legacy, { from: date, to: date })).toEqual([
      { code, date, raw: "NCNS", status: "Absent", missing: null },
    ]);
  } finally {
    legacy.close();
  }
});

it("refreshes return confirmations immediately on an owner correction and Undo", () => {
  seed();
  db.prepare(
    "INSERT INTO schedule_days VALUES (?,?,'09:00','Scheduled','09:00',?)",
  ).run(code, today, today);
  paste("");
  const returned = () =>
    discrepanciesOf(db).find((row) => row.ruleId === "D7")!;
  expect(returned().state).toBe("open");
  db.prepare(
    "INSERT INTO attendance_corrections VALUES (?,?,'active - site','Present',?)",
  ).run(code, date, privateText);
  refreshAttendanceRules(db, today, true);
  expect(returned().state).toBe("resolved");
  db.prepare("DELETE FROM attendance_corrections").run();
  refreshAttendanceRules(db, today, true);
  expect(returned().state).toBe("open");
});

it("matches distinct whole labels case-insensitively, consuming longest overlaps without guessing", () => {
  const map = attendancePasteStatusMap;
  for (const [text, label] of [
    ["Changed to FORCED ANNUAL.", "forced annual"],
    ["1ST HALF FORCED ANNUAL", "1st half forced annual"],
    ["sick; Sick", "sick"],
    ["Approved UPL", "upl"],
  ])
    expect(commentStatus(text, map).label).toBe(label);
  for (const text of [
    "Annual or Sick",
    "Forced Annual, Annual",
    "NCNS → Forced Annual",
  ])
    expect(commentStatus(text, map)).toEqual({
      label: null,
      status: null,
      explained: false,
    });
  for (const text of ["annualized", "sickness", "UPLift", privateText])
    expect(commentStatus(text, map).explained).toBe(true);
  expect(commentStatus("", map)).toEqual({
    label: null,
    status: null,
    explained: false,
  });
});

it("uses a sheet correction everywhere, retains WFM, adjusts MTD by daily deltas, and excludes notes from all exports", () => {
  seed();
  const log = vi.spyOn(console, "log"),
    error = vi.spyOn(console, "error");
  const prepared = paste("Forced Annual · " + privateText, "NCNS", {
    late: 12,
    breakExceeded: true,
  });
  const model = load(),
    agent = model.agents[0];
  const day = agent.calendar.find((row) => row.date === date)!.attendance!;
  expect(day).toMatchObject({
    raw: "Forced Annual",
    status: "PTO",
    absence: null,
    late: null,
    missing: null,
    breakExceeded: false,
    correction: {
      wfmRaw: "NCNS",
      wfmStatus: "Absent",
      wfmMissing: "01:00:00",
      source: "sheet",
      state: "corrected",
    },
  });
  expect(
    db
      .prepare("SELECT raw,status FROM attendance_days WHERE code=? AND date=?")
      .get(code, date),
  ).toEqual({ raw: "NCNS", status: "Absent" });
  expect(agent.counts).toMatchObject({
    source: "mtd",
    lateCount: 0,
    lateMinutes: 0,
    missingMinutes: 0,
    absences: 0,
    breakCount: 0,
  });
  expect(agent.mtd?.counts).toMatchObject({ ncns: 0, "forced annual": 1 });
  expect(
    agent.flags.some((flag) =>
      ["absence", "missing", "late", "breaks"].includes(flag.kind),
    ),
  ).toBe(false);
  const label = "NCNS → Forced Annual · TL comment";
  expect(attendanceLabel(day)).toBe(label);
  const grid = gridView(model).rows[0].cells.find((row) => row.date === date)!;
  expect(grid).toMatchObject({ status: "Leave / sick", label });
  expect(grid.details).toContainEqual([
    "TL comment",
    "Forced Annual · " + privateText,
  ]);
  const home = homeView(model);
  expect(eodReport(model, date).exceptions).toBe(0);
  expect(home.exceptions[0].status).toBe(label);
  expect(home.shoutout.people.map((row) => row.code)).toContain(code);
  expect(home.week.rows[0].cells.at(-1)?.label).toBe(label);
  const profile = profileView(model, code, discrepanciesOf(db))!;
  expect(profile.calendar.find((row) => row.date === date)?.label).toBe(label);
  expect(prepView(model, code)?.sections[0].lines.join(" ")).toContain(label);
  expect(teamView(model, model).rows[0].values.latestStatus).toBe(label);
  const exported = JSON.stringify([
    eodReport(model, date),
    attendanceEmail(model, date),
    cycleSummary(model),
    mprText(profile, true),
    escalationText(profile, true),
    exportBackup(db),
    exportDiscrepancies(discrepanciesOf(db)),
    attendancePastePreview(prepared, config, today),
  ]);
  expect(exported).not.toContain(privateText);
  expect(exported).not.toContain("Forced Annual · Synthetic");
  expect(log).not.toHaveBeenCalled();
  expect(error).not.toHaveBeenCalled();
});

it("explains flags/discrepancies without changing counts or shout-outs, and removal restores them", () => {
  seed();
  db.prepare("UPDATE schedule_days SET status='Off Day'").run();
  const trends = () =>
    calculateTrends(
      agentsOf(db),
      scheduleOf(db, { from: date, to: date }),
      attendanceOf(db, { from: date, to: date }),
      discrepanciesOf(db),
      date,
      date,
      today,
      {},
    );
  paste("");
  const before = load();
  const originalTrends = trends();
  expect(before.flags.some((flag) => flag.kind === "absence")).toBe(true);
  paste(privateText);
  const explained = load();
  expect(trends()).toEqual(originalTrends);
  expect(explained.agents[0].counts).toEqual(before.agents[0].counts);
  expect(
    explained.flags.some((flag) => ["absence", "missing"].includes(flag.kind)),
  ).toBe(false);
  expect(explained.agents[0].flags).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: "absence",
        state: "explained",
        detail: expect.stringContaining(privateText),
      }),
    ]),
  );
  expect(
    discrepanciesOf(db)
      .filter((row) => row.state === "open")
      .every((row) => row.explanation === privateText),
  ).toBe(true);
  expect(homeView(explained).shoutout.people).toEqual(
    homeView(before).shoutout.people,
  );
  paste("");
  expect(load().flags.some((flag) => flag.kind === "absence")).toBe(true);
  expect(discrepanciesOf(db).every((row) => !row.explanation)).toBe(true);
});

it("removes sheet overrides on the next paste, shows WFM updated only for the same label, and keeps app precedence", () => {
  seed();
  paste("Forced Annual");
  paste("Forced Annual", "Annual"); // Same mapped PTO, different label: still an override.
  expect(
    load().agents[0].calendar.find((row) => row.date === date)?.attendance
      ?.correction?.state,
  ).toBe("corrected");
  paste("Forced Annual", "Forced Annual");
  expect(
    load().agents[0].calendar.find((row) => row.date === date)?.attendance
      ?.correction?.state,
  ).toBe("updated");
  expect(
    gridView(load()).rows[0].cells.find((row) => row.date === date)?.label,
  ).toBe("Forced Annual · WFM updated");
  paste("");
  expect(attendanceOf(db, { from: date, to: date })[0]).toMatchObject({
    raw: "NCNS",
    status: "Absent",
  });
  expect(load().flags.some((flag) => flag.kind === "absence")).toBe(true);
  db.prepare(
    "INSERT INTO attendance_corrections VALUES (?,?,'sick','Sick',?)",
  ).run(code, date, privateText);
  paste("Annual");
  expect(attendanceOf(db, { from: date, to: date })[0]).toMatchObject({
    raw: "Sick",
    status: "Sick",
    correction: { source: "app", note: privateText },
  });
  paste("");
  expect(
    load().agents[0].calendar.find((row) => row.date === date)?.attendance
      ?.status,
  ).toBe("Sick");
  expect(
    JSON.stringify([
      exportBackup(db),
      eodReport(load(), date),
      attendanceEmail(load(), date),
    ]),
  ).not.toContain(privateText);
  db.prepare("DELETE FROM attendance_corrections").run();
  paste("Annual or Sick");
  expect(
    attendanceOf(db, { from: date, to: date })[0].correction,
  ).toBeUndefined();
  paste("1st Half Annual", "NCNS", { late: 12 });
  expect(
    load().agents[0].calendar.find((row) => row.date === date)?.attendance,
  ).toMatchObject({ status: "1st Half Annual", late: 12, missing: 60 });
});

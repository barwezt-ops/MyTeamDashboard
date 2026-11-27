import { afterAll, afterEach, expect, it, vi } from "vitest";
import { openDb } from "../src/db/db.js";
import {
  agentsOf,
  attendanceOf,
  discrepanciesOf,
  scheduleOf,
} from "../src/db/repo.js";
import { calculateTrends } from "../src/api/trends.js";
import { attendanceLabel, commentWaivers } from "../src/db/corrections.js";
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
      explained: true,
      ambiguous: true,
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
    source: "daily",
    lateCount: 0,
    lateMinutes: 0,
    missingMinutes: 0,
    absences: 0,
    breakCount: 0,
  });
  expect(agent.mtd?.counts).toMatchObject({ ncns: 1, "forced annual": 0 });
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

it("ignores mentions of WFM's status before counting other labels and explains ambiguity", () => {
  seed();
  for (const [note, label] of [
    ["WFM marked NCNS, was on Forced Annual", "Forced Annual"],
    ["NCNS, Annual", "Annual"],
    ["NCNS, Forced Annual", "Forced Annual"],
  ]) {
    paste(note);
    expect(attendanceOf(db, { from: date, to: date })[0]).toMatchObject({
      raw: label,
      status: "PTO",
      correction: { state: "corrected" },
    });
  }
  for (const note of [
    "NCNS, Sick or Annual",
    "NCNS, Annual or Forced Annual",
  ]) {
    paste(note);
    const day = attendanceOf(db, { from: date, to: date })[0];
    expect(day).toMatchObject({
      raw: "NCNS",
      status: "Absent",
      correction: {
        state: "explained",
        warning: "names more than one status, not corrected",
      },
    });
    expect(
      gridView(load()).rows[0].cells.find((row) => row.date === date)?.details,
    ).toContainEqual([
      "Explained",
      "names more than one status, not corrected",
    ]);
  }
  paste("NCNS confirmed");
  expect(attendanceOf(db, { from: date, to: date })[0]).toMatchObject({
    raw: "NCNS",
    status: "Absent",
    correction: { state: "explained", warning: "" },
  });
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

it("removes sheet overrides on the next paste, explains same-status comments, and keeps app precedence", () => {
  seed();
  paste("Forced Annual");
  paste("Forced Annual", "Annual"); // Same mapped PTO: now an explanation.
  expect(
    load().agents[0].calendar.find((row) => row.date === date)?.attendance
      ?.correction?.state,
  ).toBe("explained");
  paste("Forced Annual", "Forced Annual");
  expect(
    load().agents[0].calendar.find((row) => row.date === date)?.attendance
      ?.correction?.state,
  ).toBe("explained");
  expect(
    gridView(load()).rows[0].cells.find((row) => row.date === date)?.label,
  ).toBe("Forced Annual · Explained");
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
  ).toMatchObject({
    state: "explained",
    warning: "names more than one status, not corrected",
  });
  paste("1st Half Annual", "NCNS", { late: 12 });
  expect(
    load().agents[0].calendar.find((row) => row.date === date)?.attendance,
  ).toMatchObject({ status: "1st Half Annual", late: 12, missing: 60 });
});

it("a corrected NCNS produces no NCNS flag, count or coaching absence even when WFM MTD still says NCNS", () => {
  seed();
  paste("WFM marked NCNS, was on Forced Annual");
  const model = load(),
    agent = model.agents[0];
  expect(agent.counts).toMatchObject({ source: "daily", absences: 0 });
  expect(model.flags.some((flag) => flag.kind === "absence")).toBe(false);
  expect(teamView(model, model).rows[0].values.NCNS).toBe(0);
  expect(
    prepView(model, code)?.sections.find((section) =>
      section.title.includes("Absence"),
    )?.lines ?? [],
  ).toEqual([]);
  expect(homeView(model).shoutout.people.map((row) => row.code)).toContain(
    code,
  );
  expect(
    agent.calendar.find((row) => row.date === date)?.attendance?.ncnsStreak,
  ).toBe(0);
  db.prepare(
    "INSERT INTO attendance_days VALUES (?,?,'NCNS','Absent',NULL,?)",
  ).run(code, today, today);
  db.prepare("INSERT INTO attendance_paste_details VALUES (?,?,?)").run(
    code,
    today,
    JSON.stringify({ ncnsStreak: 5 }),
  );
  const later = load().agents[0];
  expect(
    later.calendar.find((row) => row.date === today)?.attendance?.ncnsStreak,
  ).toBe(1);
  expect(later.flags.find((flag) => flag.kind === "absence")?.facts).toEqual([
    today + ":NCNS",
  ]);
});

it("waives late and missing selectively, retains WFM minutes, combines with status corrections and follows sheet removal", () => {
  seed();
  paste("Please WAIVE lateness", "Active - Site", { late: 16, missing: 40 });
  let model = load();
  let day = model.agents[0].calendar.find(
    (row) => row.date === date,
  )!.attendance!;
  expect(day).toMatchObject({
    late: 0,
    missing: 40,
    wfmLate: 16,
    correction: { state: "waived", waivers: { late: true, missing: false } },
  });
  expect(model.agents[0].counts).toMatchObject({
    lateCount: 0,
    lateMinutes: 0,
    missingMinutes: 40,
  });
  expect(model.flags.some((flag) => flag.kind === "late")).toBe(false);
  expect(model.flags.some((flag) => flag.kind === "missing")).toBe(true);
  expect(
    gridView(model).rows[0].cells.find((cell) => cell.date === date)!.details,
  ).toContainEqual(["Waiver", "16m late · waived per TL comment"]);
  paste("waive missing", "Active - Site", { late: 16, missing: 40 });
  model = load();
  expect(model.agents[0].counts).toMatchObject({
    lateCount: 1,
    lateMinutes: 16,
    missingMinutes: 0,
  });
  expect(model.flags.some((flag) => flag.kind === "missing")).toBe(false);
  paste("waive late and missing", "Active - Site", { late: 16, missing: 40 });
  model = load();
  day = model.agents[0].calendar.find((row) => row.date === date)!.attendance!;
  expect(day).toMatchObject({
    late: 0,
    missing: 0,
    wfmLate: 16,
    wfmMissing: 40,
  });
  expect(homeView(model).shoutout.people.map((row) => row.code)).toContain(
    code,
  );
  expect(
    prepView(model, code)
      ?.sections.flatMap((section) => section.lines)
      .join(" "),
  ).not.toContain("16 minutes late");
  paste("Forced Annual; waive late and missing", "NCNS", {
    late: 16,
    missing: 40,
  });
  model = load();
  expect(
    model.agents[0].calendar.find((row) => row.date === date)?.attendance,
  ).toMatchObject({
    status: "PTO",
    absence: null,
    late: 0,
    missing: 0,
    correction: { state: "corrected", waivers: { late: true, missing: true } },
  });
  paste("", "Active - Site", { late: 16, missing: 40 });
  expect(load().agents[0].counts).toMatchObject({
    lateCount: 1,
    lateMinutes: 16,
    missingMinutes: 40,
  });
});

it("recognizes only the owner's waiver words and retains sheet waivers under an app status correction", () => {
  seed();
  for (const note of ["late", "waive unrelated"])
    expect(commentWaivers(note)).toEqual({ late: false, missing: false });
  expect(commentWaivers("WAIVED LATENESS and missing")).toEqual({
    late: true,
    missing: true,
  });
  paste("waive late", "NCNS", { late: 16 });
  db.prepare(
    "INSERT INTO attendance_corrections VALUES (?,?,'active - site','Present',?)",
  ).run(code, date, privateText);
  const day = load().agents[0].calendar.find(
    (row) => row.date === date,
  )!.attendance!;
  expect(day).toMatchObject({
    status: "Present",
    late: 0,
    correction: { source: "app", waivers: { late: true } },
  });
  expect(JSON.stringify(exportBackup(db))).not.toContain(privateText);
});

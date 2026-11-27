import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { openDb } from "../src/db/db.js";
import { configSchema, loadConfig } from "../src/config.js";
import { decodeCsv } from "../src/fetch/fetchCsv.js";
import { agentsOf, lastRun, lastDashboardSyncAt } from "../src/db/repo.js";
import { createSync } from "../src/sync/service.js";
import { prepareAttendancePaste } from "../src/sync/attendancePaste.js";
import {
  cycleInfo,
  expectedCoachings,
  firstCoachingDue,
  recentCycles,
} from "../src/v2/cycle.js";
import { dashboardData } from "../src/v2/data.js";
import type { DayFacts } from "../src/v2/facts.js";
import { stepOutcome } from "../src/v2/outcomes.js";
import { findPatterns } from "../src/v2/patterns.js";
import * as say from "../src/v2/templates.js";
import {
  inspectHeaders,
  parseQa,
  parseQueues,
  plannedDay,
  storeQueues,
  syncQa,
  type LineHistory,
} from "../src/v2/sources.js";
import {
  exportBackup,
  parseBackup,
  previewBackup,
  restoreBackup,
} from "../src/backup/data.js";
import { settingsSchema } from "../src/v2/settings.js";
import {
  fakePaste,
  fixtureConfig,
  seedV2Fixture,
  smallTeam,
} from "../../fixtures/v2.js";

const db = openDb(":memory:");
afterEach(() => {
  for (const table of [
    "coaching_followups",
    "coachings",
    "private_notes",
    "notes",
    "flag_dismissals",
    "owner_settings",
    "attendance_paste_details",
    "attendance_mtd_snapshots",
    "attendance_paste_state",
    "attendance_days",
    "line_history",
    "qa_evaluations",
    "agents",
  ])
    db.prepare("DELETE FROM " + table).run();
});
const csv = (name: string) =>
  decodeCsv(readFileSync(`fixtures/${name}.sample.csv`, "utf8"));
const TODAY = "2026-11-20";
const snapshot = (today = TODAY, config = fixtureConfig()) =>
  dashboardData(db, config, today);
const agent = (code: string, today = TODAY) =>
  snapshot(today).agents.find((row) => row.code === code)!;
const urgent = (data = snapshot()) =>
  data.flags.filter((flag) => flag.severity === "URGENT");
const saveSettings = (settings: object) =>
  db
    .prepare("INSERT OR REPLACE INTO owner_settings VALUES ('v2',?)")
    .run(JSON.stringify(settingsSchema.parse(settings)));
const dismiss = (id: string) => {
  const flag = snapshot().flags.find((row) => row.id === id)!;
  db.prepare("INSERT OR REPLACE INTO flag_dismissals VALUES (?,?,?,?)").run(
    id,
    JSON.stringify(flag.facts),
    "Reviewed sample facts",
    "2026-11-20T12:00:00Z",
  );
};
const updateDay = (code: string, date: string, fields: object) =>
  db
    .prepare(
      "UPDATE attendance_paste_details SET fields=json_patch(fields,?) WHERE code=? AND date=?",
    )
    .run(JSON.stringify(fields), code, date);

describe("cycle utilities", () => {
  it("handles month, year and leap-day edges for any start day", () => {
    expect(cycleInfo("2026-11-26", "2026-11-26", 21)).toEqual({
      from: "2026-11-21",
      to: "2026-12-20",
      totalDays: 30,
      elapsed: 6,
      daysLeft: 24,
    });
    expect(cycleInfo("2026-12-31", "2026-12-31", 1)).toMatchObject({
      from: "2026-12-01",
      to: "2026-12-31",
      elapsed: 31,
      daysLeft: 0,
    });
    expect(cycleInfo("2024-03-01", "2024-03-01", 28)).toMatchObject({
      from: "2024-02-28",
      to: "2024-03-27",
      totalDays: 29,
    });
    // A past cycle is fully elapsed and a future one has not started.
    expect(cycleInfo("2026-10-25", "2026-11-26", 21).daysLeft).toBe(0);
    expect(cycleInfo("2026-12-25", "2026-11-26", 21).elapsed).toBe(0);
    expect(recentCycles("2027-01-05", 21, 3)).toEqual([
      { from: "2026-12-21", to: "2027-01-20" },
      { from: "2026-11-21", to: "2026-12-20" },
      { from: "2026-10-21", to: "2026-11-20" },
    ]);
  });
});

describe("generated sentences", () => {
  it("states real numbers and never mentions health or motives", () => {
    const series = (values: (number | null)[]) =>
      values.map((minutes, i) => ({
        date: `2026-11-${String(12 + i).padStart(2, "0")}`,
        minutes,
      }));
    const climbing = series([5, 0, 0, 0, 0, 0, 0, 9, 0, 0, 0, 0, 0, 62]);
    const sentences = [
      say.homeSummary({ urgentPeople: 2, soonPeople: 0, rush: "16:00" }),
      say.homeSummary({ urgentPeople: 1, soonPeople: 3, rush: "15:45" }),
      say.homeSummary({ urgentPeople: 0, soonPeople: 1 }),
      say.homeSummary({ urgentPeople: 0, soonPeople: 0 }),
      say.latenessCaption(climbing, "2026-11-25"),
      say.latenessCaption(series(Array(14).fill(0)), "2026-11-25"),
      say.latenessCaption(series([null, null]), "2026-11-25"),
      say.perfectCaption(5),
      say.perfectCaption(1),
      say.perfectCaption(0),
      say.coachingPace(9, 32, 24),
      say.coachingPace(0, 32, 4),
      say.coachingPace(32, 32, 4),
      say.coachingPace(30, 32, 0),
    ];
    expect(sentences).toEqual([
      "Two people need you before the 4 o'clock rush. Everyone else is on track.",
      "One person needs you before the 3:45 rush. Three more people have something due soon.",
      "Nothing urgent. One person has something due soon.",
      "Nothing urgent and nothing due. The team is on track.",
      "Climbing this week. Worst day was yesterday, 62 minutes.",
      "No lateness recorded on any reported day.",
      "No attendance reported for these days yet.",
      "Five people haven't missed a minute all cycle.",
      "One person hasn't missed a minute all cycle.",
      "No clean attendance record yet this cycle.",
      "23 coachings to go in 24 days: one a day or fewer.",
      "32 coachings to go in 4 days: about 8 a day.",
      "Every coaching for this cycle is done.",
      "2 coachings left and no days remaining.",
    ]);
    expect(sentences.join(" ")).not.toMatch(
      /sick|health|medical|motiv|personal|lazy|attitude/i,
    );
    expect(say.minutes("01:34:00")).toBe(94);
    expect(say.minutes("1h 34m")).toBe(94);
    expect(say.minutes("Missing punch")).toBeNull();
    expect(say.duration(94)).toBe("1h 34m");
  });
});

it("keeps MTD lateness equal to the sum of each agent's daily lateness", () => {
  seedV2Fixture(db);
  const days = [
    ...smallTeam,
    // A total beyond 24 hours stays a duration.
    { code: "99002", date: "2026-11-17", late: 900 },
    { code: "99002", date: "2026-11-18", late: 700 },
  ];
  const { attendance, mtd } = fakePaste(days);
  // The Sheets API returns these durations as day fractions.
  expect(mtd.find((row) => row.code === "99001")!.lateness).toBeCloseTo(
    38 / 1440,
  );
  const paste = prepareAttendancePaste(
    attendance,
    mtd,
    fixtureConfig(),
    agentsOf(db),
  );
  for (const { code, fields } of paste.snapshots) {
    const daily = paste.details
      .filter((row) => row.code === code)
      .reduce((sum, row) => sum + say.minutes(row.fields.lateness)!, 0);
    expect(say.minutes(fields.lateness), code).toBeCloseTo(daily);
  }
  expect(paste.snapshots.map((row) => [row.code, row.fields.lateness])).toEqual(
    [
      ["99001", "00:38:00"],
      ["99002", "26:40:00"],
      ["99005", "00:07:00"],
    ],
  );
  // The dashboard reports the same totals whether it reads MTD or daily rows.
  const fromMtd = agent("99001").counts;
  expect(fromMtd).toMatchObject({ source: "mtd", lateMinutes: 38 });
  db.prepare("DELETE FROM attendance_mtd_snapshots").run();
  expect(agent("99001").counts).toMatchObject({
    source: "daily",
    lateMinutes: 38,
    lateCount: 3,
  });
});

it("reads the exceeded-break label as a day flag", () => {
  seedV2Fixture(db);
  expect(agent("99005")).toMatchObject({ breakStreak: 2 });
  expect(agent("99005").counts.breakCount).toBe(2);
  expect(agent("99001").counts.breakCount).toBe(0);
  const config = fixtureConfig();
  expect(config.sources.attendance.paste).toBeUndefined();
});

describe("flags", () => {
  it("raises URGENT only for the owner-set lateness threshold by default", () => {
    seedV2Fixture(db);
    db.prepare(
      "UPDATE attendance_days SET raw='NCNS',status='Absent' WHERE code='99002'",
    ).run();
    const data = snapshot();
    expect(urgent(data).map((flag) => [flag.code, flag.kind])).toEqual([
      ["99001", "late"],
    ]);
    expect(urgent(data)[0]).toMatchObject({
      reason: "3 lateness incidents this cycle",
      detail: "Flag at 3 · 38 minutes total · latest yesterday, 16 minutes",
    });
    // NCNS/AWOL is information until the owner sets a threshold.
    expect(data.flags.find((flag) => flag.kind === "absence")).toMatchObject({
      severity: "LATER",
      reason: "1 NCNS/AWOL day this cycle",
    });
    expect(data.settings).toMatchObject({
      latenessIncidents: 3,
      missingMinutes: null,
      missingDays: null,
      breakConsecutive: null,
      absentDays: null,
      qaBelow: null,
      noQaDays: null,
    });
    expect(data.agents.flatMap((row) => row.flags)).not.toContainEqual(
      expect.objectContaining({ kind: "qa-gap" }),
    );
  });

  it("applies each threshold once the owner sets it", () => {
    seedV2Fixture(db);
    db.prepare(
      "UPDATE attendance_days SET raw='AWOL',status='Absent' WHERE code='99002'",
    ).run();
    db.prepare(
      "INSERT INTO qa_evaluations(code,date,score,form) VALUES ('99005','2026-11-01',70,'')",
    ).run();
    saveSettings({
      latenessIncidents: null,
      missingMinutes: 32,
      missingDays: 1,
      missingWindowDays: 3,
      breakConsecutive: 2,
      absentDays: 1,
      qaBelow: 80,
      noQaDays: 14,
    });
    const config = fixtureConfig();
    config.sources.qa = {
      access: "public",
      mode: "export",
      label: "Sample QA",
      sheetId: "FakeQa",
      gid: "0",
      tab: "QA",
      headerRows: 1,
      enabled: true,
      mappingApproved: true,
      columns: { code: "Code", date: "Date", score: "Score" },
    };
    const kinds = (code: string) =>
      urgent(snapshot(TODAY, config))
        .filter((flag) => flag.code === code)
        .map((flag) => flag.kind)
        .sort();
    expect(kinds("99001")).toEqual(["qa-gap"]);
    expect(kinds("99002")).toEqual([
      "absence",
      "missing",
      "missing-days",
      "qa-gap",
    ]);
    expect(kinds("99005")).toEqual(["breaks", "qa", "qa-gap"]);
  });

  it("puts due follow-ups and coaching pace under SOON", () => {
    seedV2Fixture(db);
    db.prepare(
      "INSERT INTO coachings VALUES (1,'99001','2026-11-12','corrective','[\"attendance\"]','[]','Sample fact','','Logged in by 15:40',1,'none',NULL,'2026-11-12T12:00:00Z')",
    ).run();
    db.prepare(
      "INSERT INTO coaching_followups VALUES (1,1,'99001','2026-11-20','open')",
    ).run();
    db.prepare(
      "INSERT INTO notes(code,date,what_happened,what_was_said,next_step,follow_up_date,done,created_at) VALUES ('99002','2026-11-01','','','','2026-11-10',0,'2026-11-01T09:00:00Z')",
    ).run();
    const data = snapshot();
    expect(
      data.flags.find((flag) => flag.id.endsWith("|followup-1")),
    ).toMatchObject({
      severity: "SOON",
      reason: "Follow-up due today",
      detail: "Agreed: Logged in by 15:40",
    });
    expect(
      data.flags.find((flag) => flag.kind.startsWith("note-followup-")),
    ).toMatchObject({ code: "99002", reason: "Follow-up overdue" });
    // Day 31 of 31, so both coachings are expected by today.
    expect(
      data.flags.find(
        (flag) => flag.id.startsWith("99001") && flag.kind === "pace",
      ),
    ).toMatchObject({
      reason: "1 of 2 coachings this cycle",
      detail: "Expected by today: 2",
    });
  });

  it("expects a coaching only once a whole one is due", () => {
    // A 30-day cycle with a target of two.
    expect(
      [1, 14, 15, 29, 30].map((day) => expectedCoachings(2, day, 30)),
    ).toEqual([0, 0, 1, 1, 2]);
    expect(firstCoachingDue(2, { from: "2026-11-21", totalDays: 30 })).toBe(
      "2026-12-05",
    );
    expect(firstCoachingDue(2, { from: "2026-10-21", totalDays: 31 })).toBe(
      "2026-11-05",
    );
    expect(
      say.coachingStanding({ behind: 0, expected: 0, firstDue: "2026-12-05" }),
    ).toBe("No coaching is due yet. The first is due on 5 Dec.");
  });

  it("brings a dismissed flag back only when new facts arrive", () => {
    seedV2Fixture(db);
    const late = urgent()[0].id;
    dismiss(late);
    expect(urgent()).toEqual([]);
    // A re-sync that changes unrelated fields is not a new fact.
    updateDay("99001", "2026-11-19", { login: "15:59:00" });
    expect(urgent()).toEqual([]);
    // Neither is a correction that removes an incident.
    saveSettings({ latenessIncidents: 2 });
    db.prepare("DELETE FROM attendance_mtd_snapshots").run();
    updateDay("99001", "2026-11-17", { lateness: "00:00:00" });
    expect(urgent()).toEqual([]);
    // A new late day is.
    updateDay("99001", "2026-11-17", { lateness: "00:11:00" });
    expect(urgent().map((flag) => flag.id)).toEqual([late]);
  });

  it("reopens coaching pace only when another coaching falls due", () => {
    seedV2Fixture(db);
    const pace = "99002|2026-10-21|pace";
    const open = (today: string) =>
      snapshot(today).flags.some((flag) => flag.id === pace);
    // Nothing is due before mid-cycle.
    expect(open("2026-10-25")).toBe(false);
    expect(open("2026-11-04")).toBe(false);
    const middle = "2026-11-05";
    const flag = snapshot(middle).flags.find((row) => row.id === pace)!;
    expect(flag.detail).toBe("Expected by today: 1");
    db.prepare("INSERT INTO flag_dismissals VALUES (?,?,?,?)").run(
      pace,
      JSON.stringify(flag.facts),
      "Planned",
      "2026-11-05T12:00:00Z",
    );
    expect(open("2026-11-19")).toBe(false);
    // The second falls due on the last day.
    expect(open("2026-11-20")).toBe(true);
    // Logging the first one does not hide the second falling due.
    db.prepare(
      "INSERT INTO coachings VALUES (9,'99002','2026-11-06','corrective','[\"attendance\"]','[]','Sample fact','','Sample step',1,'none',NULL,'2026-11-06T12:00:00Z')",
    ).run();
    expect(open("2026-11-19")).toBe(false);
    expect(open("2026-11-20")).toBe(true);
  });
});

describe("patterns and agreed steps", () => {
  const day = (date: string, extra: Partial<DayFacts> = {}): DayFacts => ({
    date,
    status: "Present",
    raw: "Active - Site",
    late: 0,
    missing: 0,
    breakExceeded: false,
    absence: null,
    shift: null,
    login: null,
    logout: null,
    ...extra,
  });
  it("reports weekday, after-OFF and break patterns from recorded days", () => {
    const sundays = ["10-25", "11-01", "11-08", "11-15", "11-22"].map((d, i) =>
      day("2026-" + d, { late: i === 1 ? 0 : 5 }),
    );
    const missing = ["2026-11-03", "2026-11-10"].map((date) =>
      day(date, { missing: 20 }),
    );
    const off = new Set(["2026-11-02", "2026-11-09"]);
    const patterns = findPatterns(
      [...sundays, ...missing].sort((a, b) => a.date.localeCompare(b.date)),
      missing,
      (date) => off.has(date),
    );
    expect(patterns.map((p) => p.text)).toEqual([
      "Late 4 of the last 5 Sundays.",
      "Missing time twice right after an OFF day this cycle.",
    ]);
    // Days off do not break a run of exceeded breaks.
    expect(
      findPatterns(
        [
          day("2026-11-01", { breakExceeded: true }),
          day("2026-11-02", { status: "Off Day" }),
          day("2026-11-03", { breakExceeded: true }),
        ],
        [],
        () => false,
      ).map((p) => p.text),
    ).toEqual(["Break exceeded 2 days running."]);
  });
  it("works out whether a measurable step was kept", () => {
    const coaching = { date: "2026-11-10", measure: "lateness", target: 0 };
    const clean = [day("2026-11-11"), day("2026-11-12")];
    expect(stepOutcome(coaching, "2026-11-12", clean)?.result).toBe("kept");
    expect(stepOutcome(coaching, "2026-11-14", clean)?.result).toBe("pending");
    expect(
      stepOutcome(coaching, "2026-11-14", [day("2026-11-11", { late: 3 })]),
    ).toEqual({ result: "not kept", value: 1, target: 0 });
    expect(
      stepOutcome(coaching, "2026-11-12", [day("2026-11-20")])?.result,
    ).toBe("no data");
    expect(
      stepOutcome({ ...coaching, measure: "none" }, "2026-11-12", clean),
    ).toBeNull();
  });
});

describe("line/queue source", () => {
  const codes = new Set(["99001", "99002", "99009"]);
  it("keeps whitelisted fields, records changes by Cairo date and warns", () => {
    const { records, warnings } = parseQueues(csv("line-queue"), codes);
    expect(Object.keys(records[0]).sort()).toEqual([
      "account",
      "code",
      "line",
      "template",
    ]);
    expect(records.map((row) => row.code)).toEqual(["99001", "99002"]);
    expect(warnings).toEqual(["QUEUE_AGENTS_MISSING:1"]);
    const at = (stamp: string) =>
      storeQueues(db, records, new Date(stamp), "Africa/Cairo");
    at("2026-11-21T22:30:00Z");
    at("2026-11-23T10:00:00Z");
    records[0].line = "Sample dental";
    at("2026-11-24T10:00:00Z");
    const history = db
      .prepare("SELECT * FROM line_history WHERE code='99001' ORDER BY id")
      .all() as LineHistory[];
    expect(history.map((row) => [row.changed_on, row.line])).toEqual([
      ["2026-11-22", "Sample inbound"],
      ["2026-11-24", "Sample dental"],
    ]);

    const config = loadConfig();
    const plan = (date: string, dated: Parameters<typeof plannedDay>[2] = []) =>
      plannedDay("99001", date, dated, history, config);
    expect(plan("2026-11-24")).toMatchObject({
      shiftStart: "15:45",
      source: "template",
    });
    const dated = (raw: string) => [
      {
        code: "99001",
        date: "2026-11-24",
        raw,
        status: raw ? ("Off Day" as const) : ("Unknown" as const),
        shiftStart: null,
      },
    ];
    expect(plan("2026-11-24", dated("OFF"))).toMatchObject({
      status: "Off Day",
      source: "dated",
    });
    // A blank cell is no entry. An unrecognised one is kept as it is.
    expect(plan("2026-11-24", dated(""))?.source).toBe("template");
    expect(
      plan("2026-11-24", [
        { ...dated("")[0], raw: "TBC", status: "Unknown" as const },
      ]),
    ).toMatchObject({ status: "Unknown", source: "dated" });
    // No template applies before the first read of the tab.
    expect(plan("2026-11-21")).toBeNull();
  });
  it("supports configured header names and refuses unsafe tabs", () => {
    const rows = csv("line-queue");
    const renamed = [
      ["Title row"],
      ["Agent code", "Name", "Client", "Queue", ...rows[0].slice(4)],
      ...rows.slice(1),
    ];
    expect(
      parseQueues(renamed, codes, {
        headerRows: 2,
        headers: { code: "Agent code", line: "Queue", account: "Client" },
      }).records,
    ).toHaveLength(2);
    expect(() =>
      parseQueues([[...rows[0], "Caller MRN"], rows[1]], codes),
    ).toThrow("patient or caller");
    expect(() => parseQueues([rows[0], rows[1], rows[1]], codes)).toThrow(
      "Duplicate",
    );
    expect(() => parseQueues([rows[0]], codes)).toThrow("NO_TEAM_ROWS");
    const blank = rows[2].map((value, i) => (i === 3 ? "" : value));
    expect(parseQueues([rows[0], rows[1], blank], codes).warnings).toContain(
      "QUEUE_LINE_BLANK:1",
    );
  });
  it("never lets a queue failure hold back attendance or rules", async () => {
    const config = loadConfig();
    config.sources.attendance.enabled = true;
    config.sources.lineQueue = {
      ...config.sources.lineQueue!,
      enabled: true,
      sheetId: "FakeQueue",
      gid: "0",
      headers: { code: "Missing", line: "Line", account: "Account" },
    };
    const own = openDb(":memory:");
    try {
      const sync = createSync(
        own,
        config,
        "fixture",
        () => new Date("2026-11-21T11:00:00Z"),
      );
      expect(await sync.start("all")).toBe(false);
      expect(lastRun(own, "lineQueue")).toMatchObject({ ok: false });
      expect(lastRun(own, "attendance")).toMatchObject({ ok: true });
      expect(lastRun(own, "rules")).toMatchObject({ ok: true });
      expect(lastDashboardSyncAt(own)).not.toBeNull();
    } finally {
      own.close();
    }
  });
});

describe("QA scaffolding", () => {
  it("reports headers and a row count only, marking what cannot be mapped", () => {
    const report = inspectHeaders([
      ["Code", "Date", "Score", "TL Comment", "a@example.invalid"],
      ["99001", "2026-11-20", "92", "Private text", "x"],
    ]);
    expect(report).toEqual({
      headers: [
        { column: "A", header: "Code", refused: false },
        { column: "B", header: "Date", refused: false },
        { column: "C", header: "Score", refused: false },
        { column: "D", header: "TL Comment", refused: true },
        { column: "E", header: "[excluded]", refused: true },
      ],
      rowCount: 1,
      stop: null,
    });
    expect(JSON.stringify(report)).not.toMatch(/Private text|99001/);
    for (const header of [
      "Patient",
      "Caller name",
      "MRN",
      "DOB",
      "Call ID",
      "call_id",
      "Recording link",
    ])
      expect(inspectHeaders([["Code", header]]).stop, header).toContain("Stop");
    for (const header of ["Phone", "Comments", "Email"]) {
      expect(inspectHeaders([[header]]).headers[0].refused).toBe(true);
      expect(inspectHeaders([[header]]).stop).toBeNull();
    }
  });

  it("needs an approved mapping and replaces only the pairs it reads", async () => {
    seedV2Fixture(db);
    const config = loadConfig();
    const source = {
      ...config.sources.qa!,
      enabled: true,
      sheetId: "FakeQa",
      gid: "0",
    };
    expect(
      configSchema.safeParse({
        ...config,
        sources: { ...config.sources, qa: source },
      }).success,
    ).toBe(false);
    expect(await syncQa(db, config, "fixture")).toMatchObject({ rowsKept: 0 });
    config.sources.qa = {
      ...source,
      mappingApproved: true,
      columns: {
        code: "Code",
        date: "Evaluation date",
        score: "Score",
        form: "Form",
      },
    };
    expect(parseQa(csv("qa"), config, new Set(["99001"]))).toEqual([
      {
        code: "99001",
        date: "2026-11-19",
        score: 93.5,
        form: "Sample support",
      },
      { code: "99001", date: "2026-11-20", score: 95, form: "Sample support" },
    ]);
    db.prepare(
      "INSERT INTO qa_evaluations(code,date,score,form) VALUES ('99001','2026-11-01',80,''),('99001','2026-11-19',10,'')",
    ).run();
    await syncQa(db, config, "fixture");
    expect(
      db
        .prepare(
          "SELECT score FROM qa_evaluations WHERE code='99001' ORDER BY date",
        )
        .pluck()
        .all(),
    ).toEqual([80, 93.5, 95]);
    config.sources.qa.columns!.form = "Comment";
    expect(() =>
      parseQa(
        [["Code", "Evaluation date", "Score", "Comment"]],
        config,
        new Set(),
      ),
    ).toThrow("refused");
  });
});

it("backs up and restores every owner record, keeping them for older files", () => {
  seedV2Fixture(db);
  db.prepare(
    "INSERT INTO coachings VALUES (1,'99001','2026-11-19','recognition','[\"recognition\"]','[]','Sample fact','','Sample step',1,'none',NULL,'2026-11-19T12:00:00Z')",
  ).run();
  db.prepare(
    "INSERT INTO coaching_followups VALUES (1,1,'99001','2026-11-21','open')",
  ).run();
  db.prepare(
    "INSERT INTO private_notes VALUES (1,'99001','2026-11-19','Private sample','[\"sample\"]','2026-11-19T12:00:00Z','2026-11-19T12:00:00Z')",
  ).run();
  storeQueues(
    db,
    parseQueues(csv("line-queue"), new Set(["99001"])).records,
    new Date("2026-11-19T12:00:00Z"),
    "Africa/Cairo",
  );
  dismiss(urgent()[0].id);
  saveSettings({ missingMinutes: 30 });
  const content = exportBackup(db);
  const file = parseBackup(Buffer.from(content));
  const legacy = JSON.parse(content);
  delete legacy.owner;
  restoreBackup(db, parseBackup(Buffer.from(JSON.stringify(legacy))));
  expect(db.prepare("SELECT COUNT(*) FROM coachings").pluck().get()).toBe(1);
  for (const table of [
    "coaching_followups",
    "coachings",
    "private_notes",
    "flag_dismissals",
    "owner_settings",
    "line_history",
  ])
    db.prepare("DELETE FROM " + table).run();
  expect(previewBackup(db, file).changes.owner).toMatchObject({ added: 6 });
  restoreBackup(db, file);
  expect(JSON.parse(exportBackup(db)).owner).toEqual(JSON.parse(content).owner);
});

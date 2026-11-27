import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";
import { openDb } from "../src/db/db.js";
import { readAttendancePasteTabs } from "../src/fetch/attendancePaste.js";
import { columnAt, indexOf } from "../src/parse/columns.js";
import { coachingCycle } from "../src/parse/normalize.js";
import { attendancePasteStatusMap } from "../src/parse/status.js";
import {
  attendancePasteStale,
  prepareAttendancePaste,
  storeAttendancePaste,
} from "../src/sync/attendancePaste.js";
import { sampleMaster } from "./sample.js";
import { jobRunner } from "../src/sync/runJob.js";

it("reads only approved fields as serial values and stops before data reads on patient headers", async () => {
  const directory = mkdtempSync(join(tmpdir(), "team-attendance-paste-"));
  const header = (columns: Record<string, string>) => {
    const values: string[] = [];
    for (const [column, label] of Object.entries(columns))
      values[indexOf(column)] = label;
    return values;
  };
  const attendance = header({
    A: "Code",
    B: "Name",
    C: "Team Leader",
    G: "Date",
    H: "Scheduled Shift",
    I: "Status",
    J: "Login Time",
    K: "Logout Time",
    Q: "Lateness",
    AG: "Duration Of break Exceeding",
    AH: "Exceeded",
    AQ: "NCNS Streak",
    AW: "Missing After Compensation",
    AX: "TL Comment",
    AY: "Ops Comment",
    AZ: "WFM Comment",
  });
  const mtd = header({
    A: "Team Leader",
    B: "Employee ID",
    C: "Agent Name",
    F: "Lateness mins",
    G: "Lateness Incidents",
    H: "Public Holiday",
    AI: "Total deducted days",
    AQ: "Status",
    AM: "Comment",
    AT: "Medical allowance",
  });
  const calls: string[][] = [];
  let emptyMtd = false;
  const request: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.hostname === "oauth2.googleapis.com")
      return Response.json({ access_token: "test-access" });
    expect(url.searchParams.get("valueRenderOption")).toBe("UNFORMATTED_VALUE");
    expect(url.searchParams.get("dateTimeRenderOption")).toBe("SERIAL_NUMBER");
    const ranges = url.searchParams.getAll("ranges");
    calls.push(ranges);
    return Response.json({
      valueRanges: ranges.map((range) => {
        if (range === "'Attendance'!1:1") return { values: [attendance] };
        if (range === "'MTD'!4:4") return { values: emptyMtd ? [] : [mtd] };
        if (range === "'MTD'!D1:E3")
          return {
            values: emptyMtd ? [] : [["Total Missing Hours", "Total OT Hours"]],
          };
        if (range === "'Team View'!1:1") return { values: [["Code"]] };
        const [, start, end] = /!([A-Z]+)\d+:([A-Z]+)$/.exec(range)!;
        const row = [];
        for (let i = indexOf(start); i <= indexOf(end); i++) {
          const column = columnAt(i);
          expect(["AY", "AZ", "AM", "AT", "L", "M"]).not.toContain(column);
          row.push(
            column === "G" ? 46_000 : column === "AW" ? 1 / 24 : "99001",
          );
        }
        return { values: [row] };
      }),
    });
  };
  try {
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", "test-id");
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_SECRET", "test-secret");
    writeFileSync(
      join(directory, "google-token.json"),
      JSON.stringify({ refresh_token: "test-refresh" }),
    );
    const [day, snapshot] = await readAttendancePasteTabs(
      "FakePaste",
      directory,
      ["Attendance", "MTD"],
      false,
      request,
    );
    expect(day.rows[0]).toMatchObject({
      code: "99001",
      date: 46_000,
      missing: 1 / 24,
      tlComment: "99001",
    });
    expect(day.rows[0]).not.toHaveProperty("opsComment");
    expect(day.rows[0]).not.toHaveProperty("wfmComment");
    expect(snapshot.headers).toContainEqual({
      column: "D",
      header: "Total Missing Hours",
    });
    const check = await readAttendancePasteTabs(
      "FakePaste",
      directory,
      ["Attendance", "MTD", "Team View"],
      true,
      request,
    );
    expect(check.map((tab) => tab.rows.length)).toEqual([1, 1, 1]);
    expect(calls.at(-1)).toEqual([
      "'Attendance'!A2:A",
      "'MTD'!B5:B",
      "'Team View'!A2:A",
    ]);
    attendance[indexOf("AZ")] = "TL Comment";
    const duplicateBefore = calls.length;
    await expect(
      readAttendancePasteTabs(
        "FakePaste",
        directory,
        ["Attendance", "MTD"],
        false,
        request,
      ),
    ).rejects.toThrow("requires one TL Comment header");
    expect(calls).toHaveLength(duplicateBefore + 1);
    attendance[indexOf("AZ")] = "WFM Comment";

    emptyMtd = true;
    const optional = await readAttendancePasteTabs(
      "FakePaste",
      directory,
      ["Attendance", "MTD"],
      false,
      request,
    );
    expect(optional.map((tab) => tab.rows.length)).toEqual([1, 0]);
    expect(calls.at(-1)?.some((range) => range.startsWith("'MTD'!"))).toBe(
      false,
    );
    emptyMtd = false;

    attendance[indexOf("AX")] = "Patient record";
    const before = calls.length;
    await expect(
      readAttendancePasteTabs(
        "FakePaste",
        directory,
        ["Attendance", "MTD"],
        false,
        request,
      ),
    ).rejects.toThrow("Possible patient data");
    expect(calls).toHaveLength(before + 1);
  } finally {
    vi.unstubAllEnvs();
    rmSync(directory, { recursive: true, force: true });
  }
});

it("replaces only pasted code/date pairs, keeps daily MTD snapshots and detects unchanged pastes", () => {
  const db = openDb(":memory:");
  try {
    const agents = sampleMaster().agents.slice(0, 1);
    const [{ code }] = agents;
    const config = loadConfig();
    config.statusMap = { ...config.statusMap, ...attendancePasteStatusMap };
    const rows = [
      {
        code,
        date: "21 October 2026",
        status: "1st Half Ann",
        login: 0.5,
        missing: 0,
      },
      {
        code,
        date: (Date.UTC(2026, 9, 23) - Date.UTC(1899, 11, 30)) / 86_400_000,
        status: "Dropped",
        missing: 1 / 48,
      },
      { code: "99999", date: "invalid", status: "Unknown" },
    ];
    const snapshots = [
      {
        code,
        status: "Maternity",
        ot: 1.25,
        missing: 1 / 48,
        "count:maternity": 1,
      },
    ];
    const seed = db.prepare(
      "INSERT INTO attendance_days (code,date,raw) VALUES (?,?,?)",
    );
    seed.run(code, "2026-10-21", "Replace");
    seed.run(code, "2026-10-22", "Keep");
    seed.run("OTHER", "2026-10-21", "Keep absent agent");
    db.prepare("INSERT INTO attendance_paste_details VALUES (?,?,?)").run(
      "OTHER",
      "2026-10-21",
      "{}",
    );
    const paste = prepareAttendancePaste(rows, snapshots, config, agents);
    expect(paste.otherRows).toBe(1);
    expect(paste.records.map((row) => [row.status, row.missing])).toEqual([
      ["1st Half Annual", "00:00:00"],
      ["Inactive", "00:30:00"],
    ]);
    expect(paste.details[0].fields.login).toBe("12:00:00");
    expect(paste.snapshots[0].fields).toMatchObject({
      mappedStatus: "PTO",
      totalOTHours: "30:00:00",
      counts: { maternity: 1 },
    });
    expect(
      storeAttendancePaste(db, paste, "2026-11-26", "2026-11-26T09:00:00Z", 21),
    ).toBe(true);
    expect(
      storeAttendancePaste(db, paste, "2026-11-27", "2026-11-27T09:01:00Z", 21),
    ).toBe(false);
    expect(attendancePasteStale(db, new Date("2026-11-27T09:00:00Z"))).toBe(
      false,
    );
    expect(attendancePasteStale(db, new Date("2026-11-27T09:01:00Z"))).toBe(
      true,
    );
    expect(() =>
      prepareAttendancePaste(rows, [{ code, ot: "#REF!" }], config, agents),
    ).toThrow("more than 20%");
    expect(
      db
        .prepare("SELECT raw FROM attendance_days WHERE code=? ORDER BY date")
        .pluck()
        .all(code),
    ).toEqual(["1st Half Ann", "Keep", "Dropped"]);
    expect(
      db
        .prepare("SELECT raw FROM attendance_days WHERE code='OTHER'")
        .pluck()
        .get(),
    ).toBe("Keep absent agent");
    expect(
      db
        .prepare(
          "SELECT fields FROM attendance_paste_details WHERE code='OTHER'",
        )
        .pluck()
        .get(),
    ).toBe("{}");
    expect(
      db
        .prepare(
          "SELECT sync_date, cycle_start, cycle_end FROM attendance_mtd_snapshots ORDER BY sync_date",
        )
        .all(),
    ).toEqual([
      {
        sync_date: "2026-11-26",
        cycle_start: "2026-10-21",
        cycle_end: "2026-11-20",
      },
      {
        sync_date: "2026-11-27",
        cycle_start: "2026-10-21",
        cycle_end: "2026-11-20",
      },
    ]);
    expect(coachingCycle("2027-01-20", 21)).toEqual({
      from: "2026-12-21",
      to: "2027-01-20",
    });
  } finally {
    db.close();
  }
});

it("logs an incomplete paste as a failed sync and leaves the last successful paste intact", async () => {
  const db = openDb(":memory:");
  try {
    const agents = sampleMaster().agents.slice(0, 3);
    const config = loadConfig();
    const rows = agents.map(({ code }) => ({ code, date: "21 October 2026" }));
    const initial = prepareAttendancePaste(rows, rows, config, agents);
    const now = () => new Date("2026-11-27T09:00:00Z");
    storeAttendancePaste(db, initial, "2026-11-26", "2026-11-26T09:00:00Z", 21);
    const short = prepareAttendancePaste(
      rows.slice(0, 1),
      rows,
      config,
      agents,
    );
    const dump = () =>
      [
        "attendance_days",
        "attendance_paste_details",
        "attendance_mtd_snapshots",
        "attendance_paste_state",
      ].map((table) => db.prepare("SELECT * FROM " + table).all());
    const previous = dump();
    const success = await jobRunner(db, now).runStep("attendance", () => {
      storeAttendancePaste(db, short, "2026-11-27", now().toISOString(), 21);
      return { rowsRead: 1, rowsKept: 1, warnings: [] };
    });
    expect(success).toBe(false);
    expect(dump()).toEqual(previous);
    expect(db.prepare("SELECT ok, error FROM sync_log").get()).toEqual({
      ok: 0,
      error: "Attendance paste looks incomplete",
    });
  } finally {
    db.close();
  }
});

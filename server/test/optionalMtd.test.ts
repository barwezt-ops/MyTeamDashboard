import { afterAll, afterEach, expect, it } from "vitest";
import { openDb } from "../src/db/db.js";
import { agentsOf } from "../src/db/repo.js";
import {
  prepareAttendancePaste,
  storeAttendancePaste,
  mtdDailyMismatch,
  mtdForCycle,
  pasteDiagnostics,
} from "../src/sync/attendancePaste.js";
import { dashboardData } from "../src/v2/data.js";
import { homeView } from "../src/v2/home.js";
import { fakePaste, fixtureConfig, seedAgents } from "../../fixtures/v2.js";
import type { PasteRow } from "../src/fetch/attendancePaste.js";
import { freshness } from "../../web/src/design.js";
import type { SyncStatus } from "../src/api/dto.js";

const db = openDb(":memory:");
afterAll(() => db.close());
const config = fixtureConfig();
const today = "2026-11-27",
  date = "2026-11-22";
afterEach(() => {
  for (const table of [
    "agents",
    "attendance_days",
    "attendance_paste_details",
    "attendance_mtd_snapshots",
    "attendance_paste_state",
  ])
    db.prepare(`DELETE FROM ${table}`).run();
});
function seed() {
  seedAgents(
    db,
    Array.from({ length: 5 }, (_, i) => ["9900" + (i + 1), "Demo Agent " + i]),
  );
}
const rows = (): PasteRow[] =>
  Array.from({ length: 5 }, (_, i) => ({
    code: "9900" + (i + 1),
    date,
    status: "Active - Site",
    logout: "17:00",
  }));
const prepare = (attendance: PasteRow[], mtd: PasteRow[] = []) =>
  prepareAttendancePaste(attendance, mtd, config, agentsOf(db));
const save = (paste: ReturnType<typeof prepare>) =>
  storeAttendancePaste(db, paste, today, today + "T09:00:00Z", 21);

it("imports Attendance without MTD, keeps historic snapshots, never borrows the prior cycle, and skips the MTD shout-out gate", () => {
  seed();
  const old = fakePaste([{ code: "99001", date: "2026-11-20", late: 90 }]);
  storeAttendancePaste(
    db,
    prepare(old.attendance, old.mtd),
    "2026-11-26",
    "2026-11-26T09:00:00Z",
    21,
  );
  const current = prepare(rows());
  save(current);
  expect(
    db
      .prepare(
        "SELECT COUNT(*) FROM attendance_mtd_snapshots WHERE cycle_start='2026-11-21'",
      )
      .pluck()
      .get(),
  ).toBe(0);
  expect(
    db.prepare("SELECT COUNT(*) FROM attendance_mtd_snapshots").pluck().get(),
  ).toBe(1);
  expect(mtdForCycle(db, { from: "2026-11-21", to: "2026-12-20" })).toBeNull();
  expect(mtdDailyMismatch(db, current, 21, new Set(["99001"]))).toEqual([]);
  let model = dashboardData(db, config, today);
  expect(model.agents[0].counts).toMatchObject({
    source: "daily",
    lateMinutes: 0,
  });
  expect(homeView(model).shoutout.people.map((row) => row.code)).toContain(
    "99001",
  );
  save(
    prepare(rows(), [
      { code: "99001", lateness: 90 / 1440, latenessIncidents: 1 },
    ]),
  );
  expect(
    homeView(dashboardData(db, config, today)).shoutout.people.map(
      (row) => row.code,
    ),
  ).not.toContain("99001");
  save(current); // Emptying MTD again must not silently reuse an earlier current-cycle snapshot.
  model = dashboardData(db, config, today);
  expect(model.agents[0].counts).toMatchObject({
    source: "daily",
    lateMinutes: 0,
  });
  expect(pasteDiagnostics(db)?.mtdAvailable).toBe(false);
});

it("blanks non-key errors, keeps their rows and warns by code, date and column; exactly 20% is accepted", () => {
  seed();
  const input = rows();
  input[0].logout = "#VALUE!";
  input[0].login = "#REF!";
  const paste = prepare(input);
  save(paste);
  expect(paste.records).toHaveLength(5);
  expect(paste.details[0].fields).toMatchObject({ logout: null, login: null });
  expect(paste.warnings).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        code: "99001",
        date,
        column: "Logout Time",
        error: "#VALUE!",
        rejected: false,
      }),
    ]),
  );
  expect(pasteDiagnostics(db)?.warnings).toEqual(paste.warnings);
  input[1].logout = "#N/A";
  expect(() => prepare(input)).toThrow("more than 20%");
  expect(db.prepare("SELECT COUNT(*) FROM attendance_days").pluck().get()).toBe(
    5,
  );
});

it("refuses only a row with a Code or Date formula error and preserves previously stored data", () => {
  seed();
  save(prepare(rows()));
  for (const key of ["code", "date"]) {
    const input = rows();
    input[0][key] = "#REF!";
    const paste = prepare(input);
    save(paste);
    expect(paste.records).toHaveLength(4);
    expect(paste.warnings[0]).toMatchObject({
      column: key === "code" ? "Code" : "Date",
      rejected: true,
    });
    expect(
      db.prepare("SELECT COUNT(*) FROM attendance_days").pluck().get(),
    ).toBe(5);
  }
});

it("names missing current-cycle MTD on the freshness line even if an old sync date is present", () => {
  const status = {
    date: today,
    attendanceThrough: date,
    mtdSyncedOn: "2026-11-20",
    mtdMissing: true,
    sources: [{ job: "attendance", enabled: true }],
    jobs: { roster: { lastSuccessAt: today + "T09:00:00Z" } },
    running: null,
  } as unknown as SyncStatus;
  expect(freshness(status).text).toContain("MTD for this cycle not pasted yet");
  expect(freshness(status).text).not.toContain("Attendance & MTD");
});

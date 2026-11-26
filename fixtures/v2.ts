// Synthetic V2 data. Attendance goes through the real paste preparation, so
// fixtures keep the shapes the Sheets API returns: durations as day fractions
// and a text label for an exceeded break.
import type { Db } from "../server/src/db/db.js";
import { loadConfig } from "../server/src/config.js";
import { agentsOf } from "../server/src/db/repo.js";
import { coachingCycle } from "../server/src/parse/normalize.js";
import { attendancePasteStatusMap } from "../server/src/parse/status.js";
import {
  prepareAttendancePaste,
  storeAttendancePaste,
} from "../server/src/sync/attendancePaste.js";

export type FakeDay = {
  code: string;
  date: string;
  /** Raw WFM status label. */
  status?: string;
  late?: number;
  missing?: number;
  breakExceeded?: boolean;
  shift?: string;
  login?: string;
};

export const fraction = (minutes: number) => minutes / 1440;
const time = (value: string) => {
  const [hours, minutes] = value.split(":").map(Number);
  return fraction(hours * 60 + minutes);
};

export const fixtureConfig = () => {
  const config = loadConfig();
  config.statusMap = { ...attendancePasteStatusMap, ...config.statusMap };
  return config;
};

/** The two tabs of the paste workbook, with MTD totals for the latest cycle. */
export function fakePaste(days: FakeDay[]) {
  const latest = days.reduce((a, b) => (b.date > a ? b.date : a), "");
  const cycle = coachingCycle(latest, 21);
  const attendance = days.map((day) => {
    const status = day.status ?? "Active - Site";
    const worked = status.startsWith("Active");
    return {
      code: day.code,
      date: day.date,
      status,
      shift: worked ? time(day.shift ?? "15:45") : status,
      login: worked ? time(day.login ?? "15:44") : status,
      logout: worked ? time("00:45") : status,
      lateness: fraction(day.late ?? 0),
      missing: fraction(day.missing ?? 0),
      exceeded: day.breakExceeded ? "Exceeded" : "",
    };
  });
  const mtd = [...new Set(days.map((day) => day.code))].map((code) => {
    const own = days.filter(
      (day) =>
        day.code === code && day.date >= cycle.from && day.date <= cycle.to,
    );
    const total = (key: "late" | "missing") =>
      own.reduce((sum, day) => sum + fraction(day[key] ?? 0), 0);
    return {
      code,
      lateness: total("late"),
      latenessIncidents: own.filter((day) => day.late).length,
      missing: total("missing"),
      ot: 0,
      deductedDays: 0,
      status: "Active",
    };
  });
  return { attendance, mtd };
}

export function seedAttendance(db: Db, days: FakeDay[], syncDate: string) {
  const { attendance, mtd } = fakePaste(days);
  const paste = prepareAttendancePaste(
    attendance,
    mtd,
    fixtureConfig(),
    agentsOf(db),
  );
  storeAttendancePaste(db, paste, syncDate, syncDate + "T09:00:00Z", 21);
}

export function seedAgents(db: Db, agents: [code: string, name: string][]) {
  const stamp = "2026-11-19T09:00:00Z";
  const insert = db.prepare(
    "INSERT OR IGNORE INTO agents(code,first_name,full_name,account,account2,dtl,tl,stl,title,hire_date,last_working_day,owner_group,active,first_seen,last_seen) VALUES (?,?,?,'Support','','Demo Lead','Sample Lead','','Agent','2025-01-12',NULL,'mine',1,?,?)",
  );
  for (const [code, full] of agents)
    insert.run(code, full.split(" ")[0], full, stamp, stamp);
}

export const smallTeam: FakeDay[] = [
  { code: "99001", date: "2026-11-17", late: 8 },
  { code: "99001", date: "2026-11-18", late: 14 },
  { code: "99001", date: "2026-11-19", late: 16 },
  { code: "99002", date: "2026-11-19", missing: 32, breakExceeded: true },
  { code: "99005", date: "2026-11-18", breakExceeded: true },
  { code: "99005", date: "2026-11-19", late: 7, breakExceeded: true },
];

/** Three agents with data through 19 November, as seen on 20 November. */
export function seedV2Fixture(db: Db) {
  seedAgents(db, [
    ["99001", "Avery Sample"],
    ["99002", "Jordan Sample"],
    ["99005", "Riley Sample"],
  ]);
  seedAttendance(db, smallTeam, "2026-11-20");
}

// One recorded attendance day, reduced to the facts the dashboard reports.
import type { AttendanceDay, Status } from "../api/dto.js";
import { labelOf } from "../parse/normalize.js";
import { minutes } from "./templates.js";
import { workStatus, type Correction } from "../db/corrections.js";

export type DayFacts = {
  date: string;
  status: Status;
  raw: string;
  correction?: Correction;
  /** Minutes late, or null when the source does not report it. */
  late: number | null;
  wfmLate?: number | null;
  wfmMissing?: number | null;
  /** Missing minutes after compensation, or null when not reported. */
  missing: number | null;
  /** Set by the source's label, which is what the flags count. */
  breakExceeded: boolean;
  /** Minutes over on an exceeded break, or null when not reported. */
  breakMinutes: number | null;
  absence: "NCNS" | "AWOL" | null;
  shift: string | null;
  login: string | null;
  logout: string | null;
  /** The source's running NCNS count on that day. */
  ncnsStreak: number | null;
};

// The paste repeats the status label in time cells on days off.
const clock = (value: unknown) =>
  typeof value === "string" && /^\d{1,2}:\d{2}(?::\d{2})?$/.test(value)
    ? value.slice(0, 5).padStart(5, "0")
    : null;

const count = (value: unknown) =>
  /^\d+(?:\.\d+)?$/.test(String(value ?? "")) ? Number(value) : null;

export function dayFacts(
  row: AttendanceDay,
  details: Record<string, unknown> | undefined,
  breakLabel: string,
): DayFacts {
  const wfmLate = minutes(details?.lateness);
  const wfmMissing = minutes(row.correction?.wfmMissing ?? row.missing);
  if (row.correction?.state === "corrected" && !workStatus(row.status))
    details = undefined;
  const raw = labelOf(row.raw);
  const breakExceeded =
    labelOf(String(details?.exceeded ?? "")) === labelOf(breakLabel);
  return {
    date: row.date,
    status: row.status,
    raw: row.raw,
    ...(row.correction ? { correction: row.correction } : {}),
    late: row.correction?.waivers?.late ? 0 : minutes(details?.lateness),
    missing: row.correction?.waivers?.missing ? 0 : minutes(row.missing),
    ...(row.correction?.waivers ? { wfmLate, wfmMissing } : {}),
    breakExceeded,
    breakMinutes: (breakExceeded && minutes(details?.breakOver)) || null,
    absence: raw === "ncns" ? "NCNS" : raw === "awol" ? "AWOL" : null,
    shift: clock(details?.scheduledShift),
    login: clock(details?.login),
    logout: clock(details?.logout),
    ncnsStreak: count(details?.ncnsStreak),
  };
}

/** Original WFM minutes remain visible; private comment text never leaves here. */
export function waiverLabels(day: DayFacts) {
  return [
    ...(day.correction?.waivers?.late
      ? [`${day.wfmLate ?? 0}m late · waived per TL comment`]
      : []),
    ...(day.correction?.waivers?.missing
      ? [`${day.wfmMissing ?? 0}m missing · waived per TL comment`]
      : []),
  ];
}

export const isLate = (day: DayFacts) => (day.late ?? 0) > 0;
export const isMissing = (day: DayFacts) => (day.missing ?? 0) > 0;
const unplanned: Status[] = [
  "Sick",
  "Casual",
  "UPL",
  "Absent",
  "1st Half UPL",
  "2nd Half UPL",
  "1st Half Forced UPL",
  "2nd Half Forced UPL",
];
export const isUnplanned = (day: DayFacts) => unplanned.includes(day.status);

// Statuses that end perfect attendance. Half days count as their base type.
// Annual leave, sick, public holidays and days off are allowed. NCNS and AWOL
// are recorded as Absent.
const disqualifying: Status[] = [
  "Casual",
  "Absent",
  "UPL",
  "1st Half UPL",
  "2nd Half UPL",
  "1st Half Forced UPL",
  "2nd Half Forced UPL",
];
export const breaksPerfectAttendance = (day: DayFacts) =>
  isLate(day) ||
  isMissing(day) ||
  day.absence !== null ||
  disqualifying.includes(day.status);

export const sum = (
  days: DayFacts[],
  key: "late" | "missing" | "breakMinutes",
) => days.reduce((total, day) => total + (day[key] ?? 0), 0);

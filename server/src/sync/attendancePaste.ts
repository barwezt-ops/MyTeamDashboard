import { createHash } from "node:crypto";
import { commentStatus } from "../parse/commentStatus.js";
import { mtdNotPasted } from "../api/dto.js";
import type {
  Agent,
  AttendanceDay,
  AttendanceCellWarning,
} from "../api/dto.js";

import type { Config } from "../config.js";
import type { Db } from "../db/db.js";
import {
  readAttendancePasteTabs,
  pasteColumn,
  type PasteRow,
} from "../fetch/attendancePaste.js";
import { clean, codeOf, coachingCycle, parseDate } from "../parse/normalize.js";
import { halfDayStatuses } from "../api/dto.js";
import { parseStatus } from "../parse/status.js";
import { minutes } from "../v2/templates.js";

const dayMs = 86_400_000;
const epoch = Date.UTC(1899, 11, 30);
const order = (a: string, b: string) => a.localeCompare(b, "en");
const text = (value: PasteRow[string]) => clean(String(value ?? ""));
const conversionError =
  /^#(?:REF!|VALUE!|DIV\/0!|N\/A|ERROR!|NAME\?|NUM!|NULL!)$/i;
const isError = (value: PasteRow[string]) =>
  typeof value === "string" && conversionError.test(value.trim());

function pasteDate(value: PasteRow[string], dateOrder: Config["dateOrder"]) {
  if (typeof value !== "number") return parseDate(text(value), { dateOrder });
  if (!Number.isFinite(value) || value < 1 || value > 2_958_465) return null;
  return new Date(epoch + Math.floor(value) * dayMs).toISOString().slice(0, 10);
}

export function pasteTime(value: PasteRow[string]) {
  if (typeof value !== "number") return text(value) || null;
  if (
    !Number.isFinite(value) ||
    !Number.isSafeInteger(Math.round(value * 86400))
  )
    throw new Error("Invalid attendance time or duration.");
  const seconds = Math.abs(Math.round(value * 86400));
  return (
    (value < 0 && seconds ? "-" : "") +
    [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
      .map((part) => String(part).padStart(2, "0"))
      .join(":")
  );
}

function checkedTeamRows(
  rows: PasteRow[],
  agents: Agent[],
  tab: "Attendance" | "MTD",
  dateOrder: Config["dateOrder"],
) {
  const codes = new Set(agents.map((agent) => agent.code));
  const relevant = rows.filter(
    (row) => isError(row.code) || codes.has(codeOf(text(row.code))),
  );
  const warnings: AttendanceCellWarning[] = [];
  let badRows = 0;
  const team = relevant.flatMap((row) => {
    const broken = Object.entries(row).filter(([, value]) => isError(value));
    if (!broken.length) return [row];
    badRows++;
    const rejected =
      isError(row.code) || (tab === "Attendance" && isError(row.date));
    for (const [field, value] of broken)
      warnings.push({
        tab,
        code: isError(row.code) ? null : codeOf(text(row.code)),
        date:
          tab === "Attendance" && !isError(row.date)
            ? pasteDate(row.date, dateOrder)
            : null,
        column: pasteColumn(tab, field),
        error: String(value).trim().toUpperCase(),
        rejected,
      });
    return rejected
      ? []
      : [
          Object.fromEntries(
            Object.entries(row).map(([key, value]) => [
              key,
              isError(value) ? undefined : value,
            ]),
          ),
        ];
  });
  if (badRows * 5 > relevant.length)
    throw new Error(tab + " has formula errors in more than 20% of rows.");
  if (!team.length && (tab !== "MTD" || rows.length))
    throw new Error(
      tab === "Attendance"
        ? "Attendance paste looks incomplete"
        : tab + " has no rows matching the team roster.",
    );
  return { rows: team, warnings };
}

export function prepareAttendancePaste(
  attendance: PasteRow[],
  mtd: PasteRow[],
  config: Config,
  agents: Agent[],
) {
  const records: AttendanceDay[] = [];
  const checkedAttendance = checkedTeamRows(
    attendance,
    agents,
    "Attendance",
    config.dateOrder,
  );
  const checkedMtd = checkedTeamRows(mtd, agents, "MTD", config.dateOrder);
  const warnings = [...checkedAttendance.warnings, ...checkedMtd.warnings];
  const history = new Map<
    string,
    { code: string; date: string; fields: Record<string, unknown> }
  >();
  for (const row of checkedAttendance.rows) {
    const code = codeOf(text(row.code)),
      date = pasteDate(row.date, config.dateOrder);
    if (!date) throw new Error("Attendance contains an invalid team date.");
    const key = code + "|" + date;
    if (history.has(key))
      throw new Error("Attendance contains duplicate team code/date rows.");
    const raw = text(row.status),
      missing = pasteTime(row.missing);
    records.push({
      code,
      date,
      raw,
      status: parseStatus(raw, config.statusMap).status,
      missing,
    });
    history.set(key, {
      code,
      date,
      fields: {
        name: text(row.name),
        teamLeader: text(row.leader),
        scheduledShift: pasteTime(row.shift),
        login: pasteTime(row.login),
        logout: pasteTime(row.logout),
        lateness: pasteTime(row.lateness),
        breakOver: pasteTime(row.breakOver),
        exceeded: row.exceeded ?? null,
        ncnsStreak: row.ncnsStreak ?? null,
      },
    });
  }
  const mtdTeam = checkedMtd.rows;
  const snapshots = mtdTeam
    .map((row) => {
      const counts = Object.fromEntries(
        Object.entries(row)
          .filter(([key]) => key.startsWith("count:"))
          .sort(([a], [b]) => order(a, b))
          .map(([key, value]) => [key.slice(6), value ?? null]),
      );
      return {
        code: codeOf(text(row.code)),
        fields: {
          name: text(row.name),
          teamLeader: text(row.leader),
          totalMissingHours: pasteTime(row.missing),
          totalOTHours: pasteTime(row.ot),
          lateness: pasteTime(row.lateness),
          latenessIncidents: row.latenessIncidents ?? null,
          totalDeductedDays: row.deductedDays ?? null,
          status: text(row.status),
          mappedStatus:
            text(row.status).toLowerCase() === "active"
              ? "Active"
              : parseStatus(text(row.status), config.statusMap).status,
          counts,
        },
      };
    })
    .sort((a, b) => order(a.code, b.code));
  if (new Set(snapshots.map((row) => row.code)).size !== snapshots.length)
    throw new Error("MTD contains duplicate team codes.");
  records.sort((a, b) => order(a.date, b.date) || order(a.code, b.code));
  const details = records.map((row) => history.get(row.code + "|" + row.date)!);
  const comments = checkedAttendance.rows.map((row) => ({
    code: codeOf(text(row.code)),
    date: pasteDate(row.date, config.dateOrder)!,
    note: text(row.tlComment),
    ...commentStatus(
      text(row.tlComment),
      config.statusMap,
      parseStatus(text(row.status), config.statusMap).status,
    ),
  }));
  const dates = [...new Set(records.map((row) => row.date))].sort();
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ records, details, snapshots, comments, warnings }))
    .digest("hex");
  return {
    records,
    details,
    comments,
    dates,
    snapshots,
    warnings,
    fingerprint,
    rowsRead: attendance.length,
    otherRows: attendance.length - records.length,
  };
}

export async function loadAttendancePaste(
  config: Config,
  dataDir: string,
  agents: Agent[],
  request = fetch,
) {
  const source = config.sources.attendance.paste;
  if (!source)
    throw new Error("Configure the private attendance paste workbook.");
  const [attendance, mtd] = await readAttendancePasteTabs(
    source.sheetId,
    dataDir,
    ["Attendance", "MTD"],
    false,
    request,
  );
  return prepareAttendancePaste(attendance.rows, mtd.rows, config, agents);
}

type Paste = ReturnType<typeof prepareAttendancePaste>;
export function storeAttendancePaste(
  db: Db,
  paste: Paste,
  today: string,
  now: string,
  cycleStartDay: number,
) {
  return db.transaction(() => {
    const existing = db
      .prepare(
        "SELECT fingerprint, team_code_count FROM attendance_paste_state WHERE id=1",
      )
      .get() as
      { fingerprint: string; team_code_count: number | null } | undefined;
    const teamCodeCount = new Set(paste.records.map((row) => row.code)).size;
    if (teamCodeCount * 2 < (existing?.team_code_count ?? 0))
      throw new Error("Attendance paste looks incomplete");
    const changed = existing?.fingerprint !== paste.fingerprint;
    if (changed) {
      const record = db.prepare(
        "INSERT OR REPLACE INTO attendance_days VALUES (@code,@date,@raw,@status,@missing,@now)",
      );
      const detail = db.prepare(
        "INSERT OR REPLACE INTO attendance_paste_details VALUES (?,?,?)",
      );
      for (const row of paste.records) record.run({ ...row, now });
      for (const row of paste.details)
        detail.run(row.code, row.date, JSON.stringify(row.fields));
      const removeComment = db.prepare(
        "DELETE FROM attendance_sheet_comments WHERE code=? AND date=?",
      );
      const comment = db.prepare(
        "INSERT INTO attendance_sheet_comments VALUES (@code,@date,@note,@label,@status,@explained)",
      );
      for (const row of paste.comments) {
        removeComment.run(row.code, row.date);
        // 0 = unapplied, 1 = explained, 2 = explained because several other labels remain.
        if (row.note)
          comment.run({
            ...row,
            explained: row.ambiguous ? 2 : Number(row.explained),
          });
      }
      db.prepare(
        "INSERT INTO attendance_paste_state (id,fingerprint,last_changed_at,team_code_count) VALUES (1,?,?,?) ON CONFLICT(id) DO UPDATE SET fingerprint=excluded.fingerprint,last_changed_at=excluded.last_changed_at,team_code_count=excluded.team_code_count",
      ).run(paste.fingerprint, now, teamCodeCount);
    } else if (existing.team_code_count === null) {
      db.prepare(
        "UPDATE attendance_paste_state SET team_code_count=? WHERE id=1",
      ).run(teamCodeCount);
    }
    const cycle = coachingCycle(paste.dates.at(-1)!, cycleStartDay);
    db.prepare(
      "UPDATE attendance_paste_state SET diagnostics=? WHERE id=1",
    ).run(
      JSON.stringify({
        cycleStart: cycle.from,
        cycleEnd: cycle.to,
        mtdAvailable: paste.snapshots.length > 0,
        warnings: paste.warnings,
      }),
    );
    const already = db
      .prepare(
        "SELECT 1 FROM attendance_mtd_snapshots WHERE sync_date=? LIMIT 1",
      )
      .get(today);
    if (changed || !already) {
      db.prepare("DELETE FROM attendance_mtd_snapshots WHERE sync_date=?").run(
        today,
      );
      const snapshot = db.prepare(
        "INSERT INTO attendance_mtd_snapshots VALUES (?,?,?,?,?)",
      );
      for (const row of paste.snapshots)
        snapshot.run(
          today,
          row.code,
          cycle.from,
          cycle.to,
          JSON.stringify(row.fields),
        );
    }
    return changed;
  })();
}

/**
 * Codes whose MTD lateness differs, by a minute or more, from the sum of the
 * stored daily rows in the same cycle. This only warns: nothing is changed.
 */
export function mtdDailyMismatch(
  db: Db,
  paste: Paste,
  cycleStartDay: number,
  codes: Set<string>,
) {
  if (!paste.snapshots.length) return [];
  const cycle = coachingCycle(paste.dates.at(-1)!, cycleStartDay);
  const daily = new Map<string, number>();
  for (const row of db
    .prepare(
      "SELECT code,fields FROM attendance_paste_details WHERE date BETWEEN ? AND ?",
    )
    .all(cycle.from, cycle.to) as { code: string; fields: string }[])
    daily.set(
      row.code,
      (daily.get(row.code) ?? 0) +
        (minutes(JSON.parse(row.fields).lateness) ?? 0),
    );
  return paste.snapshots.flatMap(({ code, fields }) => {
    // A blank MTD cell means none. Text that is not a duration is skipped.
    const total = fields.lateness === null ? 0 : minutes(fields.lateness);
    return codes.has(code) &&
      total !== null &&
      Math.abs(total - (daily.get(code) ?? 0)) >= 1
      ? [code]
      : [];
  });
}

export function attendancePasteStale(db: Db, now: Date) {
  const last = db
    .prepare(
      "SELECT last_changed_at AS lastChangedAt FROM attendance_paste_state WHERE id=1",
    )
    .get() as { lastChangedAt: string } | undefined;
  return !!last && now.getTime() - Date.parse(last.lastChangedAt) > dayMs;
}

export function attendancePastePreview(
  paste: Paste,
  config: Config,
  today: string,
) {
  const statusCounts: Record<string, number> = {};
  const rawStatusMap: Record<string, string> = {};
  const mtdStatusCounts: Record<string, number> = {};
  for (const row of paste.records) {
    statusCounts[row.status] = (statusCounts[row.status] ?? 0) + 1;
    if (row.raw && row.status !== "Unknown") rawStatusMap[row.raw] = row.status;
  }
  for (const { fields } of paste.snapshots)
    mtdStatusCounts[fields.mappedStatus] =
      (mtdStatusCounts[fields.mappedStatus] ?? 0) + 1;
  return {
    layout: "long" as const,
    dataRows: paste.rowsRead,
    matchedRows: paste.records.length,
    otherRows: paste.otherRows,
    unmatchedTeamRows: 0,
    invalidDateRows: 0,
    records: paste.records.length,
    dateRange: { from: paste.dates[0], to: paste.dates.at(-1)! },
    sampleStatuses: [...new Set(paste.records.map((row) => row.status))],
    statusCounts,
    rawStatusMap,
    halfDayStatuses: halfDayStatuses.filter((status) => statusCounts[status]),
    mtdRows: paste.snapshots.length,
    mtdStatusCounts,
    cycle: coachingCycle(paste.dates.at(-1)!, config.coachingCycleStartDay),
    currentCycle: coachingCycle(today, config.coachingCycleStartDay),
    warnings: [
      ...(!paste.snapshots.length ? [mtdNotPasted] : []),
      ...(paste.warnings.length
        ? [
            `Formula errors: ${paste.warnings.length} mapped cells (see Settings)`,
          ]
        : []),
    ],
  };
}

export function pasteDiagnostics(db: Db) {
  const row = db
    .prepare("SELECT diagnostics FROM attendance_paste_state WHERE id=1")
    .get() as { diagnostics: string } | undefined;
  return row
    ? (JSON.parse(row.diagnostics) as {
        cycleStart: string;
        cycleEnd: string;
        mtdAvailable: boolean;
        warnings: AttendanceCellWarning[];
      })
    : null;
}
export function mtdForCycle(db: Db, cycle: { from: string; to: string }) {
  const diagnostics = pasteDiagnostics(db);
  if (
    diagnostics?.cycleStart === cycle.from &&
    diagnostics.cycleEnd === cycle.to &&
    !diagnostics.mtdAvailable
  )
    return null;
  return (
    (db
      .prepare(
        "SELECT MAX(d.sync_date) FROM attendance_mtd_snapshots d JOIN agents a ON a.code=d.code WHERE a.owner_group='mine' AND d.cycle_start=? AND d.cycle_end=?",
      )
      .pluck()
      .get(cycle.from, cycle.to) as string | null) ?? null
  );
}

import type {
  Agent,
  AttendanceDay,
  DiscrepancyRow,
  Note,
  RosterEvent,
  ScheduleDay,
  SyncRun,
} from "../api/dto.js";
import type { Window } from "../parse/schedule.js";
import type { Db } from "./db.js";

const agentFields =
  "code, first_name AS firstName, full_name AS fullName, account, account2, dtl, tl, stl, title, hire_date AS hireDate, last_working_day AS lastWorkingDay, owner_group AS ownerGroup, active";
const discFields =
  "d.id, d.code, d.date, d.rule_id AS ruleId, d.severity, d.missing, d.source, d.state, d.tl_comment AS tlComment, d.created_at AS createdAt, d.updated_at AS updatedAt, a.first_name AS firstName, a.tl, a.account";
const noteFields =
  "id, code, date, what_happened AS whatHappened, what_was_said AS whatWasSaid, next_step AS nextStep, follow_up_date AS followUpDate, done, created_at AS createdAt";
const logFields =
  "id, job, started_at AS startedAt, finished_at AS finishedAt, ok, rows_read AS rowsRead, rows_kept AS rowsKept, warnings, error";
export function agentsOf(db: Db): Agent[] {
  return (
    db
      .prepare(
        "SELECT " + agentFields + " FROM agents ORDER BY first_name,code",
      )
      .all() as Agent[]
  ).map((row) => ({ ...row, active: Boolean(row.active) }));
}
export function saveAgent(db: Db, agent: Agent, now: string) {
  db.prepare(
    `INSERT INTO agents VALUES (@code,@firstName,@fullName,@account,@account2,@dtl,@tl,@stl,@title,@hireDate,@lastWorkingDay,@ownerGroup,@active,@now,@now)
  ON CONFLICT(code) DO UPDATE SET first_name=excluded.first_name,full_name=excluded.full_name,account=excluded.account,account2=excluded.account2,dtl=excluded.dtl,tl=excluded.tl,stl=excluded.stl,title=excluded.title,hire_date=excluded.hire_date,last_working_day=excluded.last_working_day,owner_group=excluded.owner_group,active=excluded.active,last_seen=excluded.last_seen`,
  ).run({ ...agent, active: Number(agent.active), now });
}
export function scheduleOf(db: Db, { from, to }: Window, code?: string) {
  return db
    .prepare(
      "SELECT code,date,raw,status,shift_start AS shiftStart FROM schedule_days WHERE date BETWEEN ? AND ?" +
        (code ? " AND code=?" : "") +
        " ORDER BY date",
    )
    .all(from, to, ...(code ? [code] : [])) as ScheduleDay[];
}
export function attendanceOf(db: Db, { from, to }: Window, code?: string) {
  return db
    .prepare(
      "SELECT code,date,raw,status,missing FROM attendance_days WHERE date BETWEEN ? AND ?" +
        (code ? " AND code=?" : "") +
        " ORDER BY date",
    )
    .all(from, to, ...(code ? [code] : [])) as AttendanceDay[];
}
export function discrepanciesOf(
  db: Db,
  where = "1=1",
  params: (string | number)[] = [],
) {
  return db
    .prepare(
      "SELECT " +
        discFields +
        " FROM discrepancies d JOIN agents a ON a.code=d.code WHERE " +
        where +
        " ORDER BY d.date DESC,d.code,d.rule_id",
    )
    .all(...params) as DiscrepancyRow[];
}
export function notesOf(
  db: Db,
  where = "1=1",
  params: (string | number)[] = [],
) {
  return (
    db
      .prepare(
        "SELECT " +
          noteFields +
          " FROM notes WHERE " +
          where +
          " ORDER BY date DESC,id DESC",
      )
      .all(...params) as Note[]
  ).map((row) => ({ ...row, done: Boolean(row.done) }));
}
export function eventsOf(db: Db, since: string) {
  return db
    .prepare(
      "SELECT e.*,a.first_name AS firstName FROM roster_events e JOIN agents a ON a.code=e.code WHERE e.date>=? ORDER BY e.date DESC,e.id DESC",
    )
    .all(since) as RosterEvent[];
}
type LogRow = Omit<SyncRun, "warnings" | "ok"> & {
  warnings: string | null;
  ok: number | null;
};
function parseRun(row: LogRow): SyncRun {
  return {
    ...row,
    warnings: row.warnings ? JSON.parse(row.warnings) : [],
    ok: row.ok === null ? null : !!row.ok,
  };
}
export function recentRuns(db: Db) {
  return (
    db
      .prepare(
        "SELECT " + logFields + " FROM sync_log ORDER BY id DESC LIMIT 50",
      )
      .all() as LogRow[]
  ).map(parseRun);
}
export function lastRun(db: Db, job: string) {
  const row = db
    .prepare(
      "SELECT " +
        logFields +
        " FROM sync_log WHERE job=? ORDER BY id DESC LIMIT 1",
    )
    .get(job) as LogRow | undefined;
  return row ? parseRun(row) : null;
}
export function lastSuccess(db: Db, job: string) {
  const row = db
    .prepare(
      "SELECT finished_at AS time FROM sync_log WHERE job=? AND ok=1 ORDER BY id DESC LIMIT 1",
    )
    .get(job) as { time: string } | undefined;
  return row?.time ?? null;
}

export function lastDashboardSyncAt(db: Db) {
  // Daily and all runs finish with rules after schedule or attendance.
  const row = db
    .prepare(
      `
    SELECT MAX(finished_at) AS time FROM sync_log AS run
    WHERE ok=1 AND (
      job='roster' OR (job='rules' AND (
        SELECT ok=1 AND job IN ('schedule', 'attendance')
        FROM sync_log
        WHERE id < run.id AND job <> 'backup'
        ORDER BY id DESC LIMIT 1
      ))
    )
  `,
    )
    .get() as { time: string | null };
  return row.time;
}

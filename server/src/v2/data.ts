// Composes the V2 read model from synced data and owner records. It covers the
// owner's team only.
import type { Db } from "../db/db.js";
import type { Config } from "../config.js";
import { agentsOf, attendanceOf, notesOf, scheduleOf } from "../db/repo.js";
import { plusDays } from "../parse/normalize.js";
import {
  cycleInfo,
  datesBetween,
  previousCycle,
  recentCycles,
  within,
} from "./cycle.js";
import { dayFacts, isLate, isMissing, sum, type DayFacts } from "./facts.js";
import {
  candidateFlags,
  openFlags,
  sortFlags,
  type Dismissal,
  type DueFollowUp,
} from "./flags.js";
import { stepOutcome } from "./outcomes.js";
import { breakStreak, findPatterns } from "./patterns.js";
import { plannedDay, type LineHistory } from "./sources.js";
import { readSettings } from "./settings.js";
import { minutes } from "./templates.js";

export type CoachingRow = {
  id: number;
  code: string;
  date: string;
  type: "corrective" | "recognition" | "follow-up";
  reasons: string;
  evidence: string;
  what_happened: string;
  what_was_said: string;
  next_step: string;
  acknowledged: number;
  measure: string;
  target: number | null;
  created_at: string;
};
export type FollowUp = {
  id: number;
  coaching_id: number;
  code: string;
  date: string;
  state: "open" | "done" | "kept" | "not kept";
};
export type Evaluation = {
  id: number;
  code: string;
  date: string;
  score: number;
  form: string;
};
type NoteRow = {
  id: number;
  code: string;
  date: string;
  body: string;
  tags: string;
  created_at: string;
  updated_at: string;
};
type MtdRow = { code: string; sync_date: string; fields: string };

const average = (rows: Evaluation[]) =>
  rows.length
    ? rows.reduce((total, row) => total + row.score, 0) / rows.length
    : null;

function groupByCode<T extends { code: string }>(rows: T[]) {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const group = groups.get(row.code);
    if (group) group.push(row);
    else groups.set(row.code, [row]);
  }
  return (code: string) => groups.get(code) ?? [];
}

const reportedNumber = (value: unknown) =>
  value !== null && value !== undefined && /^\d+(?:\.\d+)?$/.test(String(value))
    ? Number(value)
    : null;

export function dashboardData(
  db: Db,
  config: Config,
  today: string,
  asOf = today,
) {
  const settings = readSettings(db, config.coachingCycleStartDay);
  const cycle = cycleInfo(asOf, today, settings.cycleStartDay);
  const prior = previousCycle(cycle, settings.cycleStartDay);
  const cycles = recentCycles(asOf, settings.cycleStartDay, 6);
  const first = cycles[cycles.length - 1].from;
  const yesterday = plusDays(today, -1);
  const breakLabel = config.sources.attendance.paste?.breakExceededLabel;

  const mine = agentsOf(db).filter((agent) => agent.ownerGroup === "mine");
  const codes = new Set(mine.map((agent) => agent.code));
  const team = <T extends { code: string }>(rows: T[]) =>
    rows.filter((row) => codes.has(row.code));
  const all = <T>(sql: string, ...values: string[]) =>
    db.prepare(sql).all(...values) as T[];

  const history = team(
    all<LineHistory>("SELECT * FROM line_history ORDER BY id"),
  );
  const historyOf = groupByCode(history);
  const scheduleFor = groupByCode(
    scheduleOf(db, { from: first, to: plusDays(today, 31) }),
  );
  const attendance = team(attendanceOf(db, { from: first, to: today }));
  const attendanceFor = groupByCode(attendance);
  const details = new Map(
    all<{ code: string; date: string; fields: string }>(
      "SELECT code,date,fields FROM attendance_paste_details WHERE date>=? AND date<=?",
      first,
      today,
    ).map((row) => [row.code + "|" + row.date, JSON.parse(row.fields)]),
  );
  const coachingsFor = groupByCode(
    all<CoachingRow>("SELECT * FROM coachings ORDER BY date DESC,id DESC"),
  );
  const followUpsFor = groupByCode(
    all<FollowUp>("SELECT * FROM coaching_followups ORDER BY date,id"),
  );
  const qaFor = groupByCode(
    all<Evaluation>("SELECT * FROM qa_evaluations ORDER BY date,id"),
  );
  const privateNotesFor = groupByCode(
    all<NoteRow>("SELECT * FROM private_notes ORDER BY date DESC,id DESC"),
  );
  const dismissals = all<Dismissal>("SELECT * FROM flag_dismissals");
  const mtdFor = groupByCode(
    all<MtdRow>(
      "SELECT code,sync_date,fields FROM attendance_mtd_snapshots WHERE cycle_start=? AND cycle_end=? ORDER BY sync_date",
      cycle.from,
      cycle.to,
    ),
  );
  const qaConnected = !!config.sources.qa?.enabled;

  const agents = mine.map((agent) => {
    const { code } = agent;
    const days = attendanceFor(code).map((row) =>
      dayFacts(
        row,
        details.get(code + "|" + row.date),
        breakLabel ?? "Exceeded",
      ),
    );
    const current = days.filter((day) => within(day.date, cycle));
    const dated = scheduleFor(code);
    const lines = historyOf(code);
    const plan = (date: string) => plannedDay(code, date, dated, lines, config);
    const recordedOn = new Map(days.map((day) => [day.date, day]));
    const isOff = (date: string) =>
      (recordedOn.get(date)?.status ?? plan(date)?.status) === "Off Day";

    // MTD totals are WFM's own figures. Use them once they cover the latest
    // recorded day; otherwise add up the daily rows.
    const latestMtd = mtdFor(code).at(-1);
    const mtd = latestMtd
      ? (JSON.parse(latestMtd.fields) as Record<string, unknown>)
      : null;
    const useMtd =
      !!latestMtd &&
      latestMtd.sync_date >= plusDays(current.at(-1)?.date ?? cycle.from, 1);
    const late = current.filter(isLate);
    const missing = current.filter(isMissing);
    const counts = {
      source: useMtd ? ("mtd" as const) : ("daily" as const),
      lateCount:
        (useMtd ? reportedNumber(mtd?.latenessIncidents) : null) ?? late.length,
      // MTD lateness is a duration that equals the sum of the daily values.
      lateMinutes:
        (useMtd ? minutes(mtd?.lateness) : null) ?? sum(late, "late"),
      missingMinutes:
        (useMtd ? minutes(mtd?.totalMissingHours) : null) ??
        sum(missing, "missing"),
      missingDays: missing.length,
      breakCount: current.filter((day) => day.breakExceeded).length,
      absences: current.filter((day) => day.status === "Absent").length,
      reportedDays: current.length,
    };

    const coaching = coachingsFor(code);
    const followUps = followUpsFor(code);
    const done = coaching.filter((row) => within(row.date, cycle)).length;
    const expected =
      (settings.coachingTarget * cycle.elapsed) / cycle.totalDays;
    const notes = notesOf(db, "code=?", [code]);
    const due: DueFollowUp[] = [
      ...followUps
        .filter((row) => row.state === "open" && row.date <= today)
        .map((row) => {
          const from = coaching.find((c) => c.id === row.coaching_id)!;
          return {
            key: "followup-" + row.id,
            date: row.date,
            detail: `Agreed: ${from.next_step}`,
          };
        }),
      ...notes
        .filter(
          (note) =>
            !note.done && !!note.followUpDate && note.followUpDate <= today,
        )
        .map((note) => ({
          key: "note-followup-" + note.id,
          date: note.followUpDate!,
          detail: note.nextStep
            ? `Agreed: ${note.nextStep}`
            : "From an earlier note",
        })),
    ];

    const qa = qaFor(code);
    const currentQa = qa.filter((row) => within(row.date, cycle));
    const patterns = findPatterns(days, current, isOff);
    const candidates = candidateFlags({
      settings,
      today,
      active: agent.active,
      cycle: current,
      days,
      counts,
      coaching: { done, expected },
      followUps: due,
      qa: {
        connected: qaConnected,
        average: average(currentQa),
        latest: qa.at(-1) ?? null,
        evaluations: currentQa,
      },
      patterns,
    });
    const flags = openFlags(code, cycle.from, candidates, dismissals);

    const calendar = datesBetween(cycle.from, cycle.to).map((date) => ({
      date,
      schedule: plan(date),
      attendance: recordedOn.get(date) ?? null,
    }));
    const cycleTotals = cycles.map((range) => {
      const rows: DayFacts[] = days.filter((day) => within(day.date, range));
      return {
        ...range,
        reported: rows.length,
        lateCount: rows.filter(isLate).length,
        lateMinutes: sum(rows, "late"),
        missingMinutes: sum(rows, "missing"),
        qa: average(qa.filter((row) => within(row.date, range))),
      };
    });

    return {
      ...agent,
      line: lines.filter((row) => row.changed_on <= today).at(-1)?.line ?? null,
      lineTemplate: lines.at(-1)
        ? (JSON.parse(lines.at(-1)!.template) as string[])
        : null,
      counts,
      calendar,
      next14: datesBetween(today, plusDays(today, 13)).map((date) => ({
        date,
        schedule: plan(date),
      })),
      upcoming: datesBetween(today, plusDays(today, 30)).map((date) => ({
        date,
        schedule: plan(date),
      })),
      recent: datesBetween(plusDays(today, -14), yesterday).map((date) => ({
        date,
        attendance: recordedOn.get(date) ?? null,
        schedule: plan(date),
      })),
      coaching: coaching.map((row) => ({
        ...row,
        outcome: stepOutcome(
          row,
          followUps.find((f) => f.coaching_id === row.id)?.date ?? null,
          days,
        ),
      })),
      coachingDone: done,
      coachingExpected: expected,
      followUps,
      qa,
      qaAverage: average(currentQa),
      priorQaAverage: average(qa.filter((row) => within(row.date, prior))),
      patterns,
      breakStreak: breakStreak(days).length,
      flags,
      cycles: cycleTotals,
      mtd,
      mtdSyncedOn: latestMtd?.sync_date ?? null,
      notes,
      privateNotes: privateNotesFor(code),
      dismissals: dismissals.filter((row) => row.id.startsWith(code + "|")),
    };
  });

  const flags = sortFlags(agents.flatMap((agent) => agent.flags));
  return {
    today,
    yesterday,
    cycle,
    prior,
    settings,
    agents,
    flags,
    lineHistory: history,
    qaConnected,
    attendanceThrough:
      attendance.reduce(
        (latest, row) => (row.date > latest ? row.date : latest),
        "",
      ) || null,
  };
}
export type DashboardData = ReturnType<typeof dashboardData>;
export type V2Agent = DashboardData["agents"][number];

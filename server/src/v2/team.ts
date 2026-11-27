// The team table, with each number compared to the same point last cycle.
import { absenceCounts } from "./absences.js";
import { attendanceLabel } from "../db/corrections.js";
import { daysApart } from "./cycle.js";
import type { DashboardData, V2Agent } from "./data.js";
import { isLate, isMissing, sum, type DayFacts } from "./facts.js";
import { cycleLabel, needsAttention } from "./grid.js";
import { reportDay } from "./home.js";
import { noLine } from "./queues.js";
import { minutes, plural, shortName } from "./templates.js";

export type Column = {
  key: string;
  label: string;
  kind: "text" | "number" | "duration" | "percent" | "date" | "time" | "break";
  /** Shown until the owner picks otherwise. */
  shown: boolean;
  /** Which direction of change is an improvement. */
  better?: "up" | "down";
};

const column = (
  key: string,
  label: string,
  kind: Column["kind"] = "number",
  options: Pick<Column, "better"> & { shown?: boolean } = {},
): Column => ({ key, label, kind, shown: false, ...options });
const shown = { shown: true };
const lower = { better: "down" as const };
const lowerShown = { ...lower, ...shown };

/** MTD status counts that the sheet's Team View shows. */
const teamViewCounts = [
  ["sick", "MTD Sick"],
  ["upl", "MTD UPL"],
  ["casual", "MTD Casual"],
  ["annual", "MTD Annual"],
  ["ncns", "MTD NCNS"],
  ["awol", "MTD AWOL"],
] as const;

/**
 * Every column of the sheet's Team View, worked out from the synced data, plus
 * what the dashboard adds. The Team View tab itself is not read.
 */
const base: Column[] = [
  column("name", "Name", "text", shown),
  column("code", "Code", "text"),
  column("teamLeader", "Team Leader", "text"),
  column("line", "Line", "text", shown),
  column("account", "Account", "text"),
  column("title", "Title", "text"),
  column("hireDate", "Hire date", "date"),
  column("status", "HR Status", "text"),
  column("latestDay", "Latest Day", "date"),
  column("latestStatus", "Status (Latest Day)", "text"),
  column("latestShift", "Scheduled Shift", "time"),
  column("latestLogin", "Login", "time"),
  column("latestLogout", "Logout", "time"),
  column("latestLate", "Lateness (Latest Day)", "duration"),
  column("latestMissing", "Missing (Latest Day)", "duration"),
  column("latestBreak", "Break Exceeded (Latest Day)", "break"),
  column("ncnsStreak", "NCNS Streak"),
  column("lateCount", "Late", "number", lowerShown),
  column("lateMinutes", "Late time", "duration", lowerShown),
  column("missingMinutes", "Missing", "duration", lowerShown),
  column("daysLate", "Days Late (Cycle)", "number", lower),
  column("daysMissing", "Days With Missing (Cycle)", "number", lower),
  column("NCNS", "NCNS", "number", lower),
  column("AWOL", "AWOL", "number", lower),
  column("Sick", "Sick", "number", lowerShown),
  column("Casual", "Casual", "number", lower),
  column("Unpaid", "Unpaid", "number", lower),
  column("breaks", "Breaks Exceeded (Cycle)", "number", lowerShown),
  column("breakMinutes", "Break Time Over (Cycle)", "duration", lower),
  column("mtdMissing", "MTD Missing Hours", "duration"),
  column("otMinutes", "MTD OT Hours", "duration"),
  column("mtdLateness", "MTD Lateness Mins", "duration"),
  column("mtdIncidents", "MTD Lateness Incidents"),
  ...teamViewCounts.map(([key, label]) => column("mtd:" + key, label)),
  column("deductedDays", "MTD Deducted Days"),
  column("qa", "QA", "percent", { better: "up", ...shown }),
  column("coaching", "Coaching", "text", shown),
  column("flags", "Open flags", "number", shown),
];

/** A reported number, keeping a blank cell blank. */
const reported = (value: unknown) =>
  value === null || value === undefined || value === "" ? null : Number(value);

type Value = string | number | null;

const mean = (values: number[]) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;

/** Numbers that can be added up from the first `count` days of a cycle. */
function partial(agent: V2Agent, count: number): Record<string, number | null> {
  const days = agent.calendar.slice(0, count);
  const facts: DayFacts[] = days.flatMap((day) =>
    day.attendance ? [day.attendance] : [],
  );
  if (!facts.length) return {};
  const until = days.at(-1)!.date;
  return {
    lateCount: facts.filter(isLate).length,
    lateMinutes: sum(facts, "late"),
    missingMinutes: sum(facts.filter(isMissing), "missing"),
    breaks: facts.filter((day) => day.breakExceeded).length,
    breakMinutes: sum(facts, "breakMinutes"),
    daysLate: facts.filter(isLate).length,
    daysMissing: facts.filter(isMissing).length,
    ...absenceCounts(facts),
    qa: mean(
      agent.qa
        .filter((row) => row.date >= days[0].date && row.date <= until)
        .map((row) => row.score),
    ),
  };
}

const titleCase = (label: string) =>
  label.replace(/^\w/, (char) => char.toUpperCase());

export function teamView(data: DashboardData, previous: DashboardData) {
  const { cycle, settings } = data;
  // Days of this cycle with results, used to compare like with like.
  const last = reportDay(data) < cycle.to ? reportDay(data) : cycle.to;
  const days = Math.max(0, daysApart(cycle.from, last) + 1);
  const complete = last === cycle.to;
  const counted = new Set<string>();
  const rows = data.agents.map((agent) => {
    const facts = agent.calendar.flatMap((day) =>
      day.attendance ? [day.attendance] : [],
    );
    const mtd = agent.mtd as Record<string, unknown> | null;
    const mtdCounts = (mtd?.counts ?? {}) as Record<string, unknown>;
    const has = facts.length > 0 || !!mtd;
    const latest = facts.at(-1);
    const values: Record<string, Value> = {
      name: agent.fullName || agent.firstName,
      code: agent.code,
      teamLeader: agent.tl || null,
      line: agent.line ?? noLine,
      account: agent.account || null,
      title: agent.title || null,
      hireDate: agent.hireDate,
      status:
        (mtd?.status as string) || (agent.active ? "Active" : "Left the team"),
      latestDay: latest?.date ?? null,
      latestStatus: latest
        ? latest.correction
          ? attendanceLabel(latest)
          : (latest.absence ?? (latest.raw || latest.status))
        : null,
      latestShift: latest?.shift ?? null,
      latestLogin: latest?.login ?? null,
      latestLogout: latest?.logout ?? null,
      latestLate: latest?.late ?? null,
      latestMissing: latest?.missing ?? null,
      // Zero stands for exceeded with no minutes reported.
      latestBreak: latest?.breakExceeded ? (latest.breakMinutes ?? 0) : null,
      ncnsStreak: latest?.ncnsStreak ?? null,
      daysLate: has ? facts.filter(isLate).length : null,
      daysMissing: has ? facts.filter(isMissing).length : null,
      breakMinutes: has ? agent.counts.breakMinutes : null,
      mtdMissing: minutes(mtd?.totalMissingHours),
      mtdLateness: minutes(mtd?.lateness),
      mtdIncidents: reported(mtd?.latenessIncidents),
      lateCount: has ? agent.counts.lateCount : null,
      lateMinutes: has ? agent.counts.lateMinutes : null,
      missingMinutes: has ? agent.counts.missingMinutes : null,
      ...(has ? absenceCounts(facts) : {}),
      breaks: has ? agent.counts.breakCount : null,
      otMinutes: minutes(mtd?.totalOTHours),
      deductedDays: reported(mtd?.totalDeductedDays),
      qa: agent.qaAverage,
      coaching: `${agent.coachingDone}/${settings.coachingTarget}`,
      flags: needsAttention(agent),
    };
    for (const [key] of teamViewCounts) values["mtd:" + key] = null;
    for (const [key, value] of Object.entries(mtdCounts)) {
      counted.add(key);
      values["mtd:" + key] = reported(value);
    }
    const before = previous.agents.find((row) => row.code === agent.code);
    const then = before
      ? partial(before, complete ? before.calendar.length : days)
      : {};
    const deltas: Record<string, number> = {};
    for (const [key, value] of Object.entries(then)) {
      const now = values[key];
      if (typeof now !== "number" || value === null) continue;
      const difference = Math.round((now - value) * 10) / 10;
      if (difference) deltas[key] = difference;
    }
    return {
      code: agent.code,
      shortName: shortName(agent),
      active: agent.active,
      urgent: agent.flags.some((flag) => flag.severity === "URGENT"),
      values,
      deltas,
    };
  });
  const fixed = new Set(base.map((item) => item.key));
  const columns: Column[] = [
    ...base,
    ...[...counted]
      .filter((key) => !fixed.has("mtd:" + key))
      .sort()
      .map((key) => column("mtd:" + key, "MTD " + titleCase(key))),
  ];
  const flagged = rows.filter((row) => row.urgent).length;
  return {
    cycle: { from: cycle.from, to: cycle.to },
    label: cycleLabel(cycle),
    summary: `${plural(rows.filter((row) => row.active).length, "active agent")}. ${
      flagged
        ? `${plural(flagged, "agent")} with an urgent flag.`
        : "No urgent flags."
    }`,
    comparison: complete
      ? "Changes compare with all of the previous cycle."
      : days
        ? `Changes compare with the first ${plural(days, "day")} of the previous cycle.`
        : "No results yet to compare.",
    columns,
    rows,
    lines: [...new Set(rows.map((row) => row.values.line as string))].sort(),
    views: settings.views,
  };
}
export type TeamView = ReturnType<typeof teamView>;

// The team table, with each number compared to the same point last cycle.
import { absenceCounts } from "./absences.js";
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
  kind: "text" | "number" | "duration" | "percent" | "date";
  /** Shown until the owner picks otherwise. */
  shown: boolean;
  /** Which direction of change is an improvement. */
  better?: "up" | "down";
};

const base: Column[] = [
  { key: "name", label: "Agent", kind: "text", shown: true },
  { key: "code", label: "Code", kind: "text", shown: false },
  { key: "line", label: "Line", kind: "text", shown: true },
  { key: "account", label: "Account", kind: "text", shown: false },
  { key: "title", label: "Title", kind: "text", shown: false },
  { key: "hireDate", label: "Hire date", kind: "date", shown: false },
  { key: "status", label: "HR status", kind: "text", shown: false },
  {
    key: "lateCount",
    label: "Late",
    kind: "number",
    shown: true,
    better: "down",
  },
  {
    key: "lateMinutes",
    label: "Late time",
    kind: "duration",
    shown: true,
    better: "down",
  },
  {
    key: "missingMinutes",
    label: "Missing",
    kind: "duration",
    shown: true,
    better: "down",
  },
  { key: "NCNS", label: "NCNS", kind: "number", shown: false, better: "down" },
  { key: "AWOL", label: "AWOL", kind: "number", shown: false, better: "down" },
  { key: "Sick", label: "Sick", kind: "number", shown: true, better: "down" },
  {
    key: "Casual",
    label: "Casual",
    kind: "number",
    shown: false,
    better: "down",
  },
  {
    key: "Unpaid",
    label: "Unpaid",
    kind: "number",
    shown: false,
    better: "down",
  },
  {
    key: "breaks",
    label: "Break exceeds",
    kind: "number",
    shown: true,
    better: "down",
  },
  { key: "otMinutes", label: "Overtime", kind: "duration", shown: false },
  { key: "deductedDays", label: "Deducted days", kind: "number", shown: false },
  { key: "qa", label: "QA", kind: "percent", shown: true, better: "up" },
  { key: "coaching", label: "Coaching", kind: "text", shown: true },
  { key: "flags", label: "Open flags", kind: "number", shown: true },
];

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
  const reported = Math.max(0, daysApart(cycle.from, last) + 1);
  const complete = last === cycle.to;
  const counted = new Set<string>();
  const rows = data.agents.map((agent) => {
    const facts = agent.calendar.flatMap((day) =>
      day.attendance ? [day.attendance] : [],
    );
    const mtd = agent.mtd as Record<string, unknown> | null;
    const mtdCounts = (mtd?.counts ?? {}) as Record<string, unknown>;
    const has = facts.length > 0 || !!mtd;
    const values: Record<string, Value> = {
      name: agent.fullName || agent.firstName,
      code: agent.code,
      line: agent.line ?? noLine,
      account: agent.account || null,
      title: agent.title || null,
      hireDate: agent.hireDate,
      status:
        (mtd?.status as string) || (agent.active ? "Active" : "Left the team"),
      lateCount: has ? agent.counts.lateCount : null,
      lateMinutes: has ? agent.counts.lateMinutes : null,
      missingMinutes: has ? agent.counts.missingMinutes : null,
      ...(has ? absenceCounts(facts) : {}),
      breaks: has ? agent.counts.breakCount : null,
      otMinutes: minutes(mtd?.totalOTHours),
      deductedDays:
        mtd?.totalDeductedDays === null || mtd?.totalDeductedDays === undefined
          ? null
          : Number(mtd.totalDeductedDays),
      qa: agent.qaAverage,
      coaching: `${agent.coachingDone}/${settings.coachingTarget}`,
      flags: needsAttention(agent),
    };
    for (const [key, value] of Object.entries(mtdCounts)) {
      counted.add(key);
      values["mtd:" + key] =
        value === null || value === "" ? null : Number(value);
    }
    const before = previous.agents.find((row) => row.code === agent.code);
    const then = before
      ? partial(before, complete ? before.calendar.length : reported)
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
  const columns: Column[] = [
    ...base,
    ...[...counted].sort().map((key) => ({
      key: "mtd:" + key,
      label: "MTD " + titleCase(key),
      kind: "number" as const,
      shown: false,
    })),
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
      : reported
        ? `Changes compare with the first ${plural(reported, "day")} of the previous cycle.`
        : "No results yet to compare.",
    columns,
    rows,
    lines: [...new Set(rows.map((row) => row.values.line as string))].sort(),
    views: settings.views,
  };
}
export type TeamView = ReturnType<typeof teamView>;

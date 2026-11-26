// The attendance grid: every agent against every day of one cycle.
import { absenceCounts } from "./absences.js";
import type { DashboardData, V2Agent } from "./data.js";
import { isLate, isMissing, sum } from "./facts.js";
import { heatStatus } from "./heat.js";
import { reportDay } from "./home.js";
import { noLine } from "./queues.js";
import * as say from "./templates.js";

/** Items that need the owner: URGENT, plus due follow-ups. */
export const needsAttention = (agent: V2Agent) =>
  agent.flags.filter(
    (flag) =>
      flag.severity === "URGENT" ||
      (flag.severity === "SOON" && flag.kind !== "pace"),
  ).length;

export function dayText(
  day: V2Agent["calendar"][number],
  today: string,
): [label: string, value: string][] {
  const facts = day.attendance;
  const planned = day.schedule;
  const plan: [string, string][] = planned
    ? [
        [
          planned.source === "template"
            ? "Planned (weekly template)"
            : "Planned",
          planned.shiftStart ? say.clockTime(planned.shiftStart)! : planned.raw,
        ],
      ]
    : [];
  if (!facts)
    return [
      ...plan,
      [
        "Attendance",
        day.date >= today ? "Not reported yet" : "Nothing recorded",
      ],
    ];
  return [
    ["Status", facts.raw || facts.status],
    ...(facts.shift
      ? [["Shift", say.clockTime(facts.shift)!] as [string, string]]
      : plan),
    ["Login", say.clockTime(facts.login) ?? "—"],
    ["Logout", say.clockTime(facts.logout) ?? "—"],
    ["Late", facts.late === null ? "Not reported" : say.duration(facts.late)],
    [
      "Missing",
      facts.missing === null ? "Not reported" : say.duration(facts.missing),
    ],
    ["Break", facts.breakExceeded ? "Exceeded" : "Not exceeded"],
  ];
}

export function gridCells(agent: V2Agent, today: string) {
  return agent.calendar.map((day) => ({
    date: day.date,
    status: heatStatus(day.attendance, day.schedule?.status ?? null),
    // Planned days that have not been reported are drawn as outlines.
    planned: !day.attendance && day.date >= today,
    late: day.attendance?.late || null,
    missing: day.attendance?.missing || null,
    breakExceeded: day.attendance?.breakExceeded ?? false,
    absence: day.attendance?.absence ?? null,
    details: dayText(day, today),
  }));
}
export type GridCell = ReturnType<typeof gridCells>[number];

export function gridView(data: DashboardData) {
  const { today, cycle } = data;
  const yesterday = reportDay(data);
  const rows = data.agents
    .filter(
      (agent) => agent.active || agent.calendar.some((day) => day.attendance),
    )
    .map((agent) => {
      const recorded = agent.calendar.flatMap((day) =>
        day.attendance ? [day.attendance] : [],
      );
      return {
        code: agent.code,
        name: say.shortName(agent),
        line: agent.line ?? noLine,
        flags: needsAttention(agent),
        cells: gridCells(agent, today),
        totals: {
          lateCount: agent.counts.lateCount,
          lateMinutes: agent.counts.lateMinutes,
          missingMinutes: agent.counts.missingMinutes,
          breaks: agent.counts.breakCount,
          ...absenceCounts(recorded),
        },
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  const days = (data.agents[0]?.calendar ?? []).map(({ date }, index) => {
    const facts = data.agents.flatMap((agent) => {
      const row = agent.calendar[index].attendance;
      return row ? [row] : [];
    });
    return {
      date,
      yesterday: date === yesterday,
      today: date === today,
      reported: facts.length > 0,
      present: facts.filter((row) => row.status === "Present").length,
      late: facts.filter(isLate).length,
    };
  });
  const recorded = data.agents.flatMap((agent) =>
    agent.calendar.flatMap((day) => (day.attendance ? [day.attendance] : [])),
  );
  return {
    today,
    cycle: { from: cycle.from, to: cycle.to },
    label: cycleLabel(cycle),
    summary: say.attendanceSummary({
      lateDays: recorded.filter(isLate).length,
      lateMinutes: sum(recorded, "late"),
      missingDays: recorded.filter(isMissing).length,
      reported: recorded.length,
    }),
    days,
    rows,
    lines: [...new Set(rows.map((row) => row.line))].sort(),
    through: data.attendanceThrough,
  };
}
export type GridView = ReturnType<typeof gridView>;

export const cycleLabel = (cycle: { from: string; to: string }) =>
  `${say.shortDate(cycle.from)} to ${say.shortDate(cycle.to)} ${cycle.to.slice(0, 4)}`;

// Reports the owner copies out: end of day, the cycle summary and roster
// changes.
import type { RosterEvent } from "../api/dto.js";
import { absenceCounts, absenceTypes } from "./absences.js";
import type { DashboardData, V2Agent } from "./data.js";
import { isLate, isMissing, isUnplanned, sum, type DayFacts } from "./facts.js";
import { cycleLabel } from "./grid.js";
import { coachingTotals, exceptionRows } from "./home.js";
import { planFor, working } from "./queues.js";
import { defaultTemplate, renderTemplate, type RowValues } from "./template.js";
import * as say from "./templates.js";

const dayOf = (agent: V2Agent, date: string) =>
  agent.calendar.find((row) => row.date === date);

const longDate = (date: string) =>
  new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(date + "T00:00:00Z"));

function rowValues(agent: V2Agent, date: string): RowValues {
  const day = dayOf(agent, date);
  const facts = day?.attendance;
  const planned = day?.schedule;
  const text = (value: number | null | undefined) =>
    value ? say.duration(value) : "";
  const number = (value: number | null | undefined) =>
    value === null || value === undefined ? "" : String(Math.round(value));
  return {
    code: agent.code,
    name: say.shortName(agent),
    full_name: agent.fullName || agent.firstName,
    line: agent.line ?? "",
    account: agent.account,
    shift: say.clockTime(facts?.shift ?? planned?.shiftStart ?? null) ?? "",
    status: facts?.absence ?? facts?.status ?? planned?.status ?? "",
    login: say.clockTime(facts?.login ?? null) ?? "",
    logout: say.clockTime(facts?.logout ?? null) ?? "",
    late: text(facts?.late),
    late_minutes: number(facts?.late),
    missing: text(facts?.missing),
    missing_minutes: number(facts?.missing),
    break: facts?.breakExceeded ? "Exceeded" : "",
  };
}

/** The end-of-day table for one date, in the owner's layout. */
export function eodReport(data: DashboardData, date: string) {
  const agents = data.agents.filter(
    (agent) => agent.active || dayOf(agent, date)?.attendance,
  );
  const facts: DayFacts[] = agents.flatMap((agent) => {
    const row = dayOf(agent, date)?.attendance;
    return row ? [row] : [];
  });
  const plan = planFor(data, date);
  const exceptions = new Set(exceptionRows(data, date).map((row) => row.code));
  const rows = agents
    .map((agent) => rowValues(agent, date))
    .sort((a, b) => a.name.localeCompare(b.name));
  const count = (test: (day: DayFacts) => boolean) =>
    String(facts.filter(test).length);
  const rendered = renderTemplate(
    data.settings.reportTemplate.trim()
      ? data.settings.reportTemplate
      : defaultTemplate,
    {
      date,
      "date.long": longDate(date),
      cycle: cycleLabel(data.cycle),
      "team.size": String(plan.length),
      "team.scheduled": String(plan.filter((row) => working(row.state)).length),
      "team.present": count((day) => day.status === "Present"),
      "team.late": count(isLate),
      "team.late_minutes": String(Math.round(sum(facts, "late"))),
      "team.missing": count(isMissing),
      "team.missing_minutes": String(Math.round(sum(facts, "missing"))),
      "team.absent": count(isUnplanned),
      "team.leave": count((day) => day.status === "PTO"),
      "team.off": count((day) => day.status === "Off Day"),
    },
    {
      row: rows,
      exception: rows.filter((row) => exceptions.has(row.code)),
    },
  );
  return {
    date,
    reported: facts.length > 0,
    exceptions: exceptions.size,
    customTemplate: !!data.settings.reportTemplate.trim(),
    ...rendered,
  };
}

/** Totals for the team leader. */
export function cycleSummary(data: DashboardData) {
  const agents = data.agents.filter((agent) => agent.active);
  const facts = agents.flatMap((agent) =>
    agent.calendar.flatMap((day) => (day.attendance ? [day.attendance] : [])),
  );
  const through = facts.reduce(
    (latest, day) => (day.date > latest ? day.date : latest),
    "",
  );
  const total = (key: "lateCount" | "lateMinutes" | "missingMinutes") =>
    agents.reduce((s, agent) => s + agent.counts[key], 0);
  const absences = absenceCounts(facts);
  const coaching = coachingTotals(data);
  const averages = agents.flatMap((agent) =>
    agent.qaAverage === null ? [] : [agent.qaAverage],
  );
  const lines = [
    `Cycle summary ${cycleLabel(data.cycle)}${through ? `, results through ${say.shortDate(through)}` : ""}`,
    `Team: ${say.plural(agents.length, "active agent")}`,
    through
      ? `Lateness: ${say.plural(total("lateCount"), "incident")}, ${say.duration(total("lateMinutes"))}`
      : "Attendance: nothing reported yet",
    ...(through
      ? [
          `Missing time: ${say.duration(total("missingMinutes"))}`,
          `Absence days: ${
            absenceTypes
              .filter((type) => absences[type])
              .map((type) => `${absences[type]} ${type}`)
              .join(", ") || "none"
          }`,
          `Break exceeds: ${agents.reduce((s, a) => s + a.counts.breakCount, 0)}`,
        ]
      : []),
    averages.length
      ? `QA average: ${(averages.reduce((a, b) => a + b, 0) / averages.length).toFixed(1)}%`
      : "QA average: not available",
    `Coaching: ${coaching.done} of ${coaching.total}`,
  ];
  const table = {
    headers: [
      "Code",
      "Agent",
      "Late",
      "Late minutes",
      "Missing minutes",
      "Absence days",
      "Break exceeds",
      "QA",
      "Coaching",
    ],
    rows: agents
      .map((agent) => {
        const own = absenceCounts(
          agent.calendar.flatMap((day) =>
            day.attendance ? [day.attendance] : [],
          ),
        );
        return [
          agent.code,
          agent.fullName || agent.firstName,
          String(agent.counts.lateCount),
          String(Math.round(agent.counts.lateMinutes)),
          String(Math.round(agent.counts.missingMinutes)),
          String(absenceTypes.reduce((s, type) => s + own[type], 0)),
          String(agent.counts.breakCount),
          agent.qaAverage === null ? "" : agent.qaAverage.toFixed(1),
          `${agent.coachingDone}/${data.settings.coachingTarget}`,
        ];
      })
      .sort((a, b) => a[1].localeCompare(b[1])),
  };
  return { text: lines.join("\n"), table };
}

const eventLabel = {
  new: "New hire",
  left: "Left",
  moved: "Moved",
  rejoined: "Rejoined",
};

/** New hires, leavers, moves and agents MTD marks as dropped. */
export function rosterReport(data: DashboardData, events: RosterEvent[]) {
  const team = new Map(data.agents.map((agent) => [agent.code, agent]));
  const name = (code: string) => {
    const agent = team.get(code)!;
    return agent.fullName || agent.firstName;
  };
  const changes = events
    .filter(
      (event) =>
        team.has(event.code) &&
        event.date >= data.cycle.from &&
        event.date <= data.cycle.to,
    )
    .map((event) => [
      event.date,
      event.code,
      name(event.code),
      eventLabel[event.type],
      event.detail,
    ]);
  const dropped = data.agents.flatMap((agent) => {
    const status = String(
      (agent.mtd as Record<string, unknown> | null)?.status ?? "",
    );
    return /^(dropped|resigned|terminated)$/i.test(status.trim())
      ? [
          [
            agent.mtdSyncedOn!,
            agent.code,
            name(agent.code),
            status,
            "MTD status",
          ],
        ]
      : [];
  });
  return {
    headers: ["Date", "Code", "Agent", "Change", "Detail"],
    rows: [...changes, ...dropped].sort(
      (a, b) => b[0].localeCompare(a[0]) || a[2].localeCompare(b[2]),
    ),
  };
}

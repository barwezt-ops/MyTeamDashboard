// The Home screen: yesterday's results next to today's plan.
import { plusDays } from "../parse/normalize.js";
import { datesBetween, firstCoachingDue } from "./cycle.js";
import type { DashboardData, V2Agent } from "./data.js";
import {
  breaksPerfectAttendance,
  isLate,
  isMissing,
  isUnplanned,
  sum,
  type DayFacts,
} from "./facts.js";
import { heatStatus } from "./heat.js";
import { planFor, queuesFor, working } from "./queues.js";
import * as say from "./templates.js";

export type Tone = "good" | "warn" | "bad" | "accent";

/** Coaching progress this cycle across active agents. */
export function coachingTotals(data: DashboardData) {
  const active = data.agents.filter((agent) => agent.active);
  const target = data.settings.coachingTarget;
  // Extra coachings for one agent do not cover another agent's.
  const done = active.reduce(
    (total, agent) => total + Math.min(agent.coachingDone, target),
    0,
  );
  return {
    target,
    done,
    total: target * active.length,
    due: target * active.length - done,
    expected: active.reduce((s, agent) => s + agent.coachingExpected, 0),
    firstDue: firstCoachingDue(target, data.cycle),
    behind: active.filter(
      (a) => a.coachingDone < target && a.coachingDone < a.coachingExpected,
    ).length,
    atZero: active.filter((agent) => !agent.coachingDone).length,
    daysLeft: data.cycle.daysLeft,
  };
}

export function counts(data: DashboardData) {
  return {
    urgent: data.flags.filter((flag) => flag.severity === "URGENT").length,
    coachingDue: coachingTotals(data).due,
  };
}

/** Every recorded team day before today, by date. */
export function recordedDays(data: DashboardData) {
  const recorded = new Map<string, { agent: V2Agent; facts: DayFacts }[]>();
  for (const agent of data.agents) {
    const seen = new Set<string>();
    for (const day of [...agent.calendar, ...agent.recent]) {
      const facts = day.attendance;
      if (!facts || facts.date >= data.today || seen.has(facts.date)) continue;
      seen.add(facts.date);
      const rows = recorded.get(facts.date) ?? [];
      rows.push({ agent, facts });
      recorded.set(facts.date, rows);
    }
  }
  return recorded;
}

/** Attendance arrives for earlier days only. This is the latest one to report. */
export function reportDay(data: DashboardData) {
  const yesterday = data.yesterday;
  return data.attendanceThrough && data.attendanceThrough < yesterday
    ? data.attendanceThrough
    : yesterday;
}

export function exceptionRows(data: DashboardData, date: string) {
  return (recordedDays(data).get(date) ?? [])
    .filter(
      ({ facts }) =>
        isLate(facts) ||
        isMissing(facts) ||
        facts.breakExceeded ||
        isUnplanned(facts),
    )
    .map(({ agent, facts }) => ({
      code: agent.code,
      name: say.shortName(agent),
      line: agent.line,
      status: facts.absence ?? facts.status,
      login: say.clockTime(facts.login),
      late: facts.late ? say.duration(facts.late) : null,
      missing: facts.missing ? say.duration(facts.missing) : null,
      break: facts.breakExceeded ? say.breakOver(facts.breakMinutes) : null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

const oneDecimal = (n: number) => String(Math.round(Math.abs(n) * 10) / 10);
const mean = (values: number[]) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;

export function homeView(data: DashboardData) {
  const { today, yesterday, cycle } = data;
  const names = new Map(
    data.agents.map((agent) => [agent.code, say.shortName(agent)]),
  );
  const day = reportDay(data);
  const reportLabel = day === yesterday ? "yesterday" : say.shortDate(day);
  const recorded = recordedDays(data);
  const on = (date: string) => recorded.get(date) ?? [];
  const facts = (date: string) => on(date).map((row) => row.facts);
  const measures = {
    late: (date: string) => facts(date).filter(isLate).length,
    missing: (date: string) => sum(facts(date), "missing"),
    breaks: (date: string) => facts(date).filter((f) => f.breakExceeded).length,
  };
  const dates = [...recorded.keys()].filter((date) => date <= day).sort();
  const hasReport = on(day).length > 0;
  const earlier = dates.filter((date) => date >= cycle.from && date < day);

  /** One KPI against the cycle's daily average. */
  const tile = (
    key: keyof typeof measures,
    label: string,
    format: (value: number) => string,
    subline: (note: string) => string,
    worse: Tone,
  ) => {
    const measure = measures[key];
    const value = measure(day);
    const usual = mean(earlier.map(measure));
    const difference = usual === null ? 0 : value - usual;
    const changed = usual !== null && Math.abs(difference) >= 0.5;
    const size =
      key !== "missing"
        ? oneDecimal(difference)
        : usual !== null && usual >= 1
          ? `${oneDecimal(value / usual)}×`
          : say.duration(Math.abs(difference));
    const note =
      usual === null
        ? "no earlier day to compare"
        : !changed
          ? "about the usual"
          : difference > 0
            ? "above the usual"
            : "below the usual";
    return {
      key,
      label: `${label} ${reportLabel}`,
      value: hasReport ? format(value) : "—",
      delta:
        hasReport && changed ? `${difference > 0 ? "▲" : "▼"} ${size}` : "—",
      tone: (!hasReport || !changed
        ? "accent"
        : difference > 0
          ? worse
          : "good") as Tone,
      subline: hasReport ? subline(note) : "No attendance reported",
      bars: dates.slice(-7).map(measure),
    };
  };
  const lateMinutes = sum(facts(day), "late");
  const missingAgents = facts(day).filter(isMissing).length;

  const qa = mean(
    data.agents.flatMap((a) => (a.qaAverage === null ? [] : [a.qaAverage])),
  );
  const priorQa = mean(
    data.agents.flatMap((a) =>
      a.priorQaAverage === null ? [] : [a.priorQaAverage],
    ),
  );
  const qaChange =
    qa !== null && priorQa !== null && Math.abs(qa - priorQa) >= 0.05
      ? qa - priorQa
      : null;
  // Seven weekly averages ending today.
  const weeklyQa = Array.from({ length: 7 }, (_, i) => {
    const to = plusDays(today, (i - 6) * 7);
    return (
      mean(
        data.agents
          .flatMap((agent) => agent.qa)
          .filter((row) => row.date > plusDays(to, -7) && row.date <= to)
          .map((row) => row.score),
      ) ?? 0
    );
  });
  const kpis = [
    tile(
      "late",
      "Late",
      String,
      () => `${say.spokenMinutes(lateMinutes)} across the team`,
      "warn",
    ),
    tile(
      "missing",
      "Missing time",
      say.duration,
      () => say.plural(missingAgents, "agent"),
      "bad",
    ),
    tile(
      "breaks",
      "Break exceeds",
      String,
      (note) => say.overInTotal(sum(facts(day), "breakMinutes")) || note,
      "warn",
    ),
    {
      key: "qa" as const,
      label: "QA average",
      value: qa === null ? "—" : `${qa.toFixed(1)}%`,
      delta:
        qaChange === null
          ? "—"
          : `${qaChange > 0 ? "▲" : "▼"} ${Math.abs(qaChange).toFixed(1)}`,
      tone: (qaChange === null
        ? "accent"
        : qaChange > 0
          ? "good"
          : "warn") as Tone,
      subline: !data.qaConnected
        ? "QA not connected"
        : priorQa === null
          ? "no scores last cycle"
          : `last cycle ${priorQa.toFixed(1)}%`,
      bars: weeklyQa,
    },
  ];

  const plan = planFor(data, today);
  const present = plan.filter((row) => working(row.state));
  const queues = queuesFor(data, today);
  const away = (
    [
      ["off", "off"],
      ["annual", "on annual"],
      ["sick", "sick"],
      ["casual", "casual"],
      ["unpaid", "unpaid leave"],
      ["absent", "absent"],
      ["half day", "on a half day"],
      ["not scheduled", "not on the schedule"],
    ] as const
  ).flatMap(([state, label]) => {
    const count = plan.filter((row) => row.state === state).length;
    return count ? [`${count} ${label}`] : [];
  });
  const floor = {
    scheduled: present.length,
    team: plan.length,
    avatars: present.map(({ code, name }) => ({ code, name })),
    away,
    short: queues.flatMap((queue) =>
      queue.short
        ? [`${queue.line} is ${say.numberWord(queue.short)} short`]
        : [],
    ),
  };

  const pace = data.flags.filter((flag) => flag.kind === "pace");
  // Several pace items become one line so the list stays readable.
  const paceSummary =
    pace.length > 1
      ? {
          reason: say.behindPace(pace.length),
          detail: pace.map((flag) => names.get(flag.code)!).join(", "),
        }
      : null;
  const needs = data.flags
    .filter((flag) => flag.kind !== "pace" || !paceSummary)
    .map((flag) => ({ ...flag, name: names.get(flag.code)! }));
  const urgentFlags = data.flags.filter((flag) => flag.severity === "URGENT");
  const urgentCodes = [...new Set(urgentFlags.map((flag) => flag.code))];
  const urgent = {
    codes: urgentCodes,
    sentences: urgentFlags.map(
      (flag) => `${names.get(flag.code)} ${flag.clause ?? flag.reason}`,
    ),
  };

  const weekDates = datesBetween(plusDays(day, -6), day);
  const week = data.agents
    .filter((agent) => agent.active)
    .map((agent) => {
      const cells = weekDates.map((date) => {
        const row =
          agent.recent.find((item) => item.date === date) ??
          agent.calendar.find((item) => item.date === date);
        return {
          date,
          status: heatStatus(
            row?.attendance ?? null,
            row?.schedule?.status ?? null,
          ),
        };
      });
      return {
        code: agent.code,
        name: names.get(agent.code)!,
        cells,
        exceptions: cells.filter(
          (cell) =>
            cell.status === "Late" ||
            cell.status === "Missing" ||
            cell.status === "Absent",
        ).length,
      };
    })
    .sort(
      (a, b) => b.exceptions - a.exceptions || a.name.localeCompare(b.name),
    );

  const bars = datesBetween(plusDays(day, -13), day).map((date) => ({
    date,
    minutes: on(date).length ? Math.round(sum(facts(date), "late")) : null,
  }));
  const average = mean(
    bars.flatMap((bar) => (bar.minutes === null ? [] : [bar.minutes])),
  );
  const lateness = {
    bars,
    average: average === null ? null : Math.round(average),
    caption: say.latenessCaption(bars, yesterday),
  };

  const clean = data.agents.filter((agent) => {
    const rows = agent.calendar.flatMap((row) =>
      row.attendance && row.date < today ? [row.attendance] : [],
    );
    const { counts } = agent;
    return (
      agent.active &&
      rows.some((row) => row.status === "Present") &&
      !rows.some(breaksPerfectAttendance) &&
      // WFM's own totals also count, in case a daily row has not been pasted.
      !(counts.lateCount || counts.lateMinutes || counts.missingMinutes)
    );
  });
  const cycleThrough = dates.filter((date) => date >= cycle.from).at(-1);
  const shoutout = {
    caption: say.perfectCaption(clean.length),
    people: clean.map((agent) => ({
      code: agent.code,
      name: names.get(agent.code)!,
    })),
    text: cycleThrough
      ? say.shoutOut(
          clean.map((agent) => names.get(agent.code)!),
          cycle.from,
          cycleThrough,
        )
      : "",
  };

  // Today's busiest shift start gives the summary its deadline.
  const starts = new Map<string, number>();
  for (const row of present)
    if (row.shiftStart)
      starts.set(row.shiftStart, (starts.get(row.shiftStart) ?? 0) + 1);
  const rush =
    [...starts].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    )[0]?.[0] ?? null;
  const dueCodes = new Set(
    data.flags
      .filter(
        (flag) =>
          flag.severity === "SOON" &&
          flag.kind !== "pace" &&
          !urgentCodes.includes(flag.code),
      )
      .map((flag) => flag.code),
  );

  return {
    today,
    reportDay: day,
    reportLabel,
    summary: say.homeSummary({
      urgentPeople: urgentCodes.length,
      soonPeople: dueCodes.size,
      rush,
    }),
    urgent,
    floor,
    kpis,
    coaching: coachingTotals(data),
    needs,
    paceSummary,
    openCount: data.flags.length,
    week: {
      days: weekDates,
      rows: week,
      caption: say.weekCaption(
        week.reduce((s, row) => s + row.exceptions, 0),
        weekDates.length,
      ),
    },
    queues,
    exceptions: exceptionRows(data, day),
    hasReport,
    lateness,
    shoutout,
  };
}
export type HomeView = ReturnType<typeof homeView>;

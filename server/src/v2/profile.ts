// One agent's record: this cycle against the team, six cycles of history,
// recorded patterns, coaching, notes and discrepancies.
import type { DiscrepancyRow } from "../api/dto.js";
import { weekday, weekdays } from "../parse/normalize.js";
import { absenceCounts, absenceTypes } from "./absences.js";
import { daysApart } from "./cycle.js";
import type { DashboardData, V2Agent } from "./data.js";
import { gridCells, cycleLabel } from "./grid.js";
import { noLine } from "./queues.js";
import type { Outcome } from "./outcomes.js";
import * as say from "./templates.js";

const mean = (values: number[]) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;

function scores(agent: V2Agent) {
  const facts = agent.calendar.flatMap((day) =>
    day.attendance ? [day.attendance] : [],
  );
  const mtd = agent.mtd as Record<string, unknown> | null;
  const deducted = mtd?.totalDeductedDays;
  const reported = facts.length > 0 || !!mtd;
  const absences = absenceCounts(facts);
  return {
    absences,
    values: {
      lateCount: reported ? agent.counts.lateCount : null,
      lateMinutes: reported ? agent.counts.lateMinutes : null,
      missingMinutes: reported ? agent.counts.missingMinutes : null,
      absences: reported
        ? absenceTypes.reduce((total, type) => total + absences[type], 0)
        : null,
      breaks: reported ? agent.counts.breakCount : null,
      qa: agent.qaAverage,
      deductedDays:
        deducted === null || deducted === undefined || deducted === ""
          ? null
          : Number(deducted),
    },
  };
}

export type ScoreKey = keyof ReturnType<typeof scores>["values"];
const scoreLabels: Record<
  ScoreKey,
  [string, "number" | "duration" | "percent"]
> = {
  lateCount: ["Late incidents", "number"],
  lateMinutes: ["Late time", "duration"],
  missingMinutes: ["Missing time", "duration"],
  absences: ["Absence days", "number"],
  breaks: ["Break exceeds", "number"],
  qa: ["QA average", "percent"],
  deductedDays: ["Deducted days", "number"],
};

export function formatScore(
  value: number | null,
  kind: "number" | "duration" | "percent",
) {
  if (value === null) return "—";
  if (kind === "duration") return say.duration(value);
  if (kind === "percent") return `${value.toFixed(1)}%`;
  return String(Math.round(value * 10) / 10);
}

/** The weekly template, or the next fortnight's schedule without one. */
export function shiftPattern(agent: V2Agent) {
  const times = new Set<string>();
  const off = new Set<number>();
  if (agent.lineTemplate)
    agent.lineTemplate.forEach((raw, day) => {
      if (/^off$/i.test(raw.trim())) off.add(day);
      else if (raw.trim()) times.add(raw.trim());
    });
  else
    for (const day of agent.next14) {
      if (day.schedule?.status === "Off Day") off.add(weekday(day.date));
      else if (day.schedule?.shiftStart) times.add(day.schedule.shiftStart);
    }
  if (!times.size && !off.size) return null;
  const shifts = [...times]
    .map((time) => (/^\d{1,2}:\d{2}$/.test(time) ? say.clockTime(time)! : time))
    .join(" / ");
  // Monday first reads naturally for a work week.
  const names = [1, 2, 3, 4, 5, 6, 0]
    .filter((day) => off.has(day))
    .map((day) => weekdays[day].slice(0, 3));
  return [shifts, names.length ? "off " + names.join(", ") : ""]
    .filter(Boolean)
    .join(" · ");
}

export function newHireBadge(hireDate: string | null, today: string) {
  if (!hireDate || hireDate > today) return null;
  const days = daysApart(hireDate, today) + 1;
  const stage = [30, 60, 90].find((limit) => days <= limit);
  return stage ? `New hire · first ${stage} days` : null;
}

export function tenureText(hireDate: string | null, today: string) {
  if (!hireDate || hireDate > today) return null;
  const [y, m, d] = hireDate.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  const months = (ty - y) * 12 + tm - m - Number(td < d);
  if (months < 1) return say.plural(daysApart(hireDate, today), "day");
  const years = Math.floor(months / 12);
  return [
    years ? say.plural(years, "year") : "",
    months % 12 ? say.plural(months % 12, "month") : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export function outcomeText(
  measure: string,
  outcome: Outcome | null,
  followUp: string | null,
  state: string | null,
) {
  // The owner's own mark on the follow-up comes first.
  if (state === "kept" || state === "not kept")
    return { result: state, text: `Marked ${state} by you.` };
  if (!outcome)
    return {
      result: state === "done" ? "done" : "open",
      text:
        state === "done"
          ? "Follow-up done."
          : followUp
            ? `Follow-up ${say.shortDate(followUp)}.`
            : "No follow-up set.",
    };
  const found =
    measure === "missing"
      ? `${say.duration(outcome.value)} missing`
      : measure === "breaks"
        ? say.plural(outcome.value, "day") + " with an exceeded break"
        : say.plural(outcome.value, "lateness incident");
  const target =
    measure === "missing"
      ? say.duration(outcome.target)
      : String(outcome.target);
  const through = followUp ? ` through ${say.shortDate(followUp)}` : "";
  return {
    result: outcome.result,
    text:
      outcome.result === "no data"
        ? "No attendance recorded in the follow-up window."
        : `${found}${through}. Agreed limit: ${target}.`,
  };
}

export function profileView(
  data: DashboardData,
  code: string,
  discrepancies: DiscrepancyRow[],
) {
  const agent = data.agents.find((row) => row.code === code);
  if (!agent) return null;
  const { today } = data;
  const own = scores(agent);
  const team = data.agents.filter((row) => row.active).map(scores);
  const scorecard = (Object.keys(scoreLabels) as ScoreKey[]).map((key) => {
    const [label, kind] = scoreLabels[key];
    const average = mean(
      team.flatMap((row) =>
        row.values[key] === null ? [] : [row.values[key]],
      ),
    );
    return {
      key,
      label,
      value: formatScore(own.values[key], kind),
      team: formatScore(average, kind),
      note:
        key === "absences"
          ? absenceTypes
              .filter((type) => own.absences[type])
              .map((type) => `${own.absences[type]} ${type}`)
              .join(" · ")
          : "",
    };
  });
  const mtd = agent.mtd as Record<string, unknown> | null;
  const timeline = agent.coaching.map((row) => {
    const followUp = agent.followUps.find((f) => f.coaching_id === row.id);
    return {
      id: row.id,
      date: row.date,
      type: row.type,
      reasons: JSON.parse(row.reasons) as string[],
      evidence: JSON.parse(row.evidence) as string[],
      whatHappened: row.what_happened,
      whatWasSaid: row.what_was_said,
      nextStep: row.next_step,
      acknowledged: !!row.acknowledged,
      followUp: followUp
        ? { id: followUp.id, date: followUp.date, state: followUp.state }
        : null,
      step: outcomeText(
        row.measure,
        row.outcome,
        followUp?.date ?? null,
        followUp?.state ?? null,
      ),
    };
  });
  return {
    today,
    cycle: { from: data.cycle.from, to: data.cycle.to },
    cycleLabel: cycleLabel(data.cycle),
    agent: {
      code,
      name: agent.fullName || agent.firstName,
      firstName: agent.firstName,
      shortName: say.shortName(agent),
      line: agent.line ?? noLine,
      shift: shiftPattern(agent),
      account: agent.account,
      title: agent.title,
      teamLeader: agent.tl,
      hireDate: agent.hireDate,
      tenure: tenureText(agent.hireDate, today),
      newHire: newHireBadge(agent.hireDate, today),
      status:
        (mtd?.status as string) || (agent.active ? "Active" : "Left the team"),
    },
    scorecard,
    calendar: gridCells(agent, today),
    next7: agent.next14.slice(0, 7).map((day) => ({
      date: day.date,
      plan: day.schedule?.shiftStart
        ? say.clockTime(day.schedule.shiftStart)!
        : (day.schedule?.raw ?? "Not scheduled"),
      status: day.schedule?.status ?? null,
    })),
    // Oldest first, so the charts read left to right.
    trends: [...agent.cycles].reverse().map((row) => ({
      from: row.from,
      label: say.shortDate(row.from),
      reported: row.reported,
      lateMinutes: row.reported ? Math.round(row.lateMinutes) : null,
      lateCount: row.reported ? row.lateCount : null,
      missingMinutes: row.reported ? Math.round(row.missingMinutes) : null,
      qa: row.qa === null ? null : Math.round(row.qa * 10) / 10,
    })),
    patterns: agent.patterns.map((pattern) => pattern.text),
    flags: agent.flags,
    dismissed: agent.dismissals.map((row) => ({
      id: row.id,
      reason: row.reason,
      at: row.dismissed_at.slice(0, 10),
    })),
    coaching: {
      done: agent.coachingDone,
      target: data.settings.coachingTarget,
      timeline,
    },
    qa: {
      connected: data.qaConnected,
      average: agent.qaAverage,
      previous: agent.priorQaAverage,
      evaluations: [...agent.qa].reverse().slice(0, 12),
    },
    earlierNotes: agent.notes,
    notes: agent.privateNotes.map((row) => ({
      id: row.id,
      date: row.date,
      body: row.body,
      tags: JSON.parse(row.tags) as string[],
    })),
    discrepancies,
  };
}
export type ProfileView = NonNullable<ReturnType<typeof profileView>>;

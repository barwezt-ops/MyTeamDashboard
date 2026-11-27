// The Coaching hub: pace, who needs it, prep facts, follow-ups, history and
// the fairness counts.
import type { DashboardData, V2Agent } from "./data.js";
import {
  isLate,
  isMissing,
  sum,
  waiverLabels,
  type DayFacts,
} from "./facts.js";
import { needsAttention } from "./grid.js";
import { coachingTotals } from "./home.js";
import { outcomeText } from "./profile.js";
import type { reasons } from "./choices.js";
import * as say from "./templates.js";
import { attendanceLabel } from "../db/corrections.js";

type Reason = (typeof reasons)[number];

/** Open questions for the conversation. They are prompts, not scripts. */
export const prompts: Record<Reason, string[]> = {
  attendance: [
    "Looking at these dates together, what do you notice?",
    "What would make the start of the shift easier to keep to?",
    "What will you do on the next shift, and how will we both know?",
  ],
  quality: [
    "Which part of a recent call are you happy with?",
    "Which step in the evaluation form is least clear to you?",
    "What is one thing you want to try on the next calls?",
  ],
  behaviour: [
    "How do you understand the expectation we are discussing?",
    "What made it hard to meet on those occasions?",
    "What do you commit to, and by when?",
  ],
  recognition: [
    "What are you most pleased with this cycle?",
    "What helps you keep it up?",
    "Is there something you would like to share with the team?",
  ],
};

function history(data: DashboardData) {
  return data.agents
    .flatMap((agent) =>
      agent.coaching.map((row) => {
        const followUp = agent.followUps.find((f) => f.coaching_id === row.id);
        return {
          id: row.id,
          code: agent.code,
          name: say.shortName(agent),
          date: row.date,
          type: row.type,
          reasons: JSON.parse(row.reasons) as Reason[],
          whatHappened: row.what_happened,
          whatWasSaid: row.what_was_said,
          nextStep: row.next_step,
          acknowledged: !!row.acknowledged,
          followUpDate: followUp?.date ?? null,
          step: outcomeText(
            row.measure,
            row.outcome,
            followUp?.date ?? null,
            followUp?.state ?? null,
          ),
        };
      }),
    )
    .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
}

function followUps(data: DashboardData) {
  const { today } = data;
  const when = (date: string) =>
    date < today ? "overdue" : date === today ? "today" : "upcoming";
  const rows = data.agents.flatMap((agent) => {
    const name = say.shortName(agent);
    return [
      ...agent.followUps.map((row) => {
        const coaching = agent.coaching.find((c) => c.id === row.coaching_id)!;
        return {
          key: "followup-" + row.id,
          kind: "coaching" as const,
          id: row.id,
          code: agent.code,
          name,
          date: row.date,
          state: row.state as string,
          group: row.state === "open" ? when(row.date) : "closed",
          agreed: coaching.next_step,
          from: coaching.date,
          measured: outcomeText(
            coaching.measure,
            coaching.outcome,
            row.date,
            "open",
          ),
        };
      }),
      ...agent.notes.flatMap((note) =>
        note.followUpDate && !note.done
          ? [
              {
                key: "note-" + note.id,
                kind: "note" as const,
                id: note.id,
                code: agent.code,
                name,
                date: note.followUpDate,
                state: "open",
                group: when(note.followUpDate),
                agreed: note.nextStep || note.whatHappened,
                from: note.date,
                measured: null,
              },
            ]
          : [],
      ),
    ];
  });
  return rows.sort(
    (a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name),
  );
}

export function coachingView(data: DashboardData) {
  const totals = coachingTotals(data);
  const target = data.settings.coachingTarget;
  // Today still counts as a day to get coaching done.
  const daysToFinish = data.cycle.daysLeft + (data.cycle.elapsed ? 1 : 0);
  const agents = data.agents
    .filter((agent) => agent.active)
    .map((agent) => ({
      code: agent.code,
      name: say.shortName(agent),
      done: agent.coachingDone,
      flags: needsAttention(agent),
      behind:
        agent.coachingDone < target &&
        agent.coachingDone < agent.coachingExpected,
      last: agent.coaching[0]?.date ?? null,
    }))
    // Needs it most: open flags, then fewest this cycle, then longest ago.
    .sort(
      (a, b) =>
        b.flags - a.flags ||
        a.done - b.done ||
        (a.last ?? "").localeCompare(b.last ?? "") ||
        a.name.localeCompare(b.name),
    );
  const rows = history(data);
  const fairness = data.agents
    .filter((agent) => agent.active)
    .map((agent) => {
      const count = (list: typeof rows) => ({
        coachings: list.length,
        corrective: list.filter((row) => row.type === "corrective").length,
        recognition: list.filter((row) => row.type === "recognition").length,
        followUp: list.filter((row) => row.type === "follow-up").length,
      });
      const own = rows.filter((row) => row.code === agent.code);
      const inCycle = (date: string) =>
        date >= data.cycle.from && date <= data.cycle.to;
      const notes = [...agent.privateNotes, ...agent.notes];
      return {
        code: agent.code,
        name: say.shortName(agent),
        cycle: {
          ...count(own.filter((row) => inCycle(row.date))),
          notes: notes.filter((note) => inCycle(note.date)).length,
        },
        all: { ...count(own), notes: notes.length },
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    today: data.today,
    cycle: { from: data.cycle.from, to: data.cycle.to },
    totals,
    daysToFinish,
    pace: say.coachingPace(totals.done, totals.total, daysToFinish),
    summary: `${totals.done} of ${totals.total} done this cycle. ${say.coachingStanding(totals)}`,
    agents,
    followUps: followUps(data),
    history: rows,
    fairness,
  };
}
export type CoachingView = ReturnType<typeof coachingView>;

const dayLines = (days: DayFacts[], describe: (day: DayFacts) => string) =>
  days.map(
    (day) =>
      `${say.shortDate(day.date)}: ${describe(day)}${day.correction ? ` · ${attendanceLabel(day)}` : ""}`,
  );

/** Facts pulled together for one conversation. */
export function prepView(data: DashboardData, code: string) {
  const agent: V2Agent | undefined = data.agents.find(
    (row) => row.code === code,
  );
  if (!agent) return null;
  const days = agent.calendar.flatMap((day) =>
    day.attendance ? [day.attendance] : [],
  );
  const late = days.filter(isLate);
  const missing = days.filter(isMissing);
  const absent = days.filter((day) =>
    ["Absent", "Sick", "Casual", "UPL"].some((s) => day.status.includes(s)),
  );
  const breaks = days.filter((day) => day.breakExceeded);
  const section = (title: string, summary: string, lines: string[]) => ({
    title,
    summary,
    lines,
  });
  const qaScores = agent.qa.slice(-5);
  const last = agent.coaching[0];
  const lastFollowUp =
    last && agent.followUps.find((row) => row.coaching_id === last.id);
  const sections = [
    section(
      "Corrections and explanations",
      "Original WFM status retained. Notes stay local.",
      days
        .filter((day) => day.correction)
        .map(
          (day) =>
            `${say.shortDate(day.date)}: ${attendanceLabel(day)} · ${[...waiverLabels(day), day.correction!.note].join(" · ")}`,
        ),
    ),
    section(
      "Lateness this cycle",
      late.length
        ? `${say.plural(agent.counts.lateCount, "incident")}, ${say.spokenMinutes(agent.counts.lateMinutes)} in total.`
        : "No lateness recorded.",
      dayLines(late, (day) => say.spokenMinutes(day.late!)),
    ),
    section(
      "Missing time",
      missing.length
        ? `${say.duration(agent.counts.missingMinutes)} across ${say.plural(missing.length, "day")}.`
        : "No missing time recorded.",
      dayLines(missing, (day) => say.duration(day.missing)),
    ),
    section(
      "Absences",
      absent.length
        ? `${say.plural(absent.length, "day")} recorded.`
        : "No absence recorded.",
      dayLines(absent, (day) => day.absence ?? day.status),
    ),
    section(
      "Break exceeds",
      breaks.length
        ? [
            `Exceeded on ${say.plural(breaks.length, "day")}`,
            say.overInTotal(sum(breaks, "breakMinutes")),
          ]
            .filter(Boolean)
            .join(", ") + "."
        : "No exceeded break recorded.",
      dayLines(breaks, (day) =>
        day.breakMinutes
          ? `${say.breakOver(day.breakMinutes)} over`
          : "exceeded",
      ),
    ),
    section(
      "Quality",
      agent.qaAverage !== null
        ? `Cycle average ${agent.qaAverage.toFixed(1)}%${
            agent.priorQaAverage === null
              ? "."
              : `, last cycle ${agent.priorQaAverage.toFixed(1)}%.`
          }`
        : data.qaConnected
          ? "No evaluation this cycle."
          : "QA is not connected.",
      qaScores.map((row) => `${say.shortDate(row.date)}: ${row.score}%`),
    ),
    section(
      "Last coaching",
      last
        ? `${say.shortDate(last.date)}. Agreed: ${last.next_step}`
        : "No earlier coaching recorded.",
      last
        ? [
            outcomeText(
              last.measure,
              last.outcome,
              lastFollowUp?.date ?? null,
              lastFollowUp?.state ?? null,
            ),
          ].map((step) => `${say.sentenceCase(step.result)}. ${step.text}`)
        : [],
    ),
    section(
      "Patterns",
      agent.patterns.length
        ? `${say.plural(agent.patterns.length, "pattern")} in the recorded days.`
        : "No repeating pattern in the recorded days.",
      agent.patterns.map((pattern) => pattern.text),
    ),
  ];
  const evidence = [
    ...agent.flags
      .filter((flag) => flag.kind !== "pace")
      .map((flag) => ({
        id: flag.id,
        label: `${flag.severity}: ${flag.reason}`,
      })),
    ...days
      .filter(
        (day) =>
          isLate(day) || isMissing(day) || day.breakExceeded || day.absence,
      )
      .reverse()
      .map((day) => ({
        id: `${code}|${day.date}`,
        label: `${say.shortDate(day.date)}: ${[
          isLate(day) ? `late ${say.duration(day.late)}` : "",
          isMissing(day) ? `missing ${say.duration(day.missing)}` : "",
          day.breakExceeded ? say.breakIncident(day.breakMinutes) : "",
          day.absence ?? "",
        ]
          .filter(Boolean)
          .join(", ")}`,
      })),
  ];
  return {
    code,
    name: agent.fullName || agent.firstName,
    today: data.today,
    cycle: { from: data.cycle.from, to: data.cycle.to },
    done: agent.coachingDone,
    target: data.settings.coachingTarget,
    lateMinutes: Math.round(sum(late, "late")),
    sections,
    evidence,
    // Reasons the record suggests come first. All four are always available.
    suggested: [
      late.length || missing.length || absent.length || breaks.length
        ? "attendance"
        : "recognition",
    ] as Reason[],
    prompts,
  };
}
export type PrepView = NonNullable<ReturnType<typeof prepView>>;

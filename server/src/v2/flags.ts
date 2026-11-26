// The flags engine. URGENT only ever comes from a threshold the owner has set.
// SOON covers due follow-ups and coaching pace. LATER is information.
import { createHash } from "node:crypto";
import { plusDays } from "../parse/normalize.js";
import { isLate, isMissing, type DayFacts } from "./facts.js";
import { breakStreak, type Pattern } from "./patterns.js";
import type { V2Settings } from "./settings.js";
import { duration, plural, shortDate, spokenMinutes } from "./templates.js";

export const severities = ["URGENT", "SOON", "LATER"] as const;
export type Severity = (typeof severities)[number];
export type Flag = {
  id: string;
  code: string;
  kind: string;
  severity: Severity;
  reason: string;
  detail: string;
  /** Changes whenever the facts do. Sent back when dismissing. */
  token: string;
  action: "Coach" | "Review" | "View";
};
export type Candidate = Omit<Flag, "id" | "code" | "token"> & {
  facts: string[];
};
export type Dismissal = {
  id: string;
  facts: string;
  reason: string;
  dismissed_at: string;
};
export type DueFollowUp = {
  key: string;
  date: string;
  /** What was agreed, shown as the detail line. */
  detail: string;
};

export type FlagInput = {
  settings: V2Settings;
  today: string;
  active: boolean;
  /** This cycle's recorded days, oldest first. */
  cycle: DayFacts[];
  /** Recent days across cycles, oldest first. */
  days: DayFacts[];
  counts: { lateCount: number; lateMinutes: number; missingMinutes: number };
  coaching: { done: number; expected: number };
  followUps: DueFollowUp[];
  qa: {
    connected: boolean;
    average: number | null;
    latest: { date: string } | null;
    evaluations: { date: string; score: number }[];
  };
  patterns: Pattern[];
};

const numbered = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, i) => `${prefix}#${i + 1}`);

export function candidateFlags(input: FlagInput): Candidate[] {
  const { settings, today, cycle, days, counts, qa } = input;
  const flags: Candidate[] = [];
  const add = (
    kind: string,
    severity: Severity,
    action: Flag["action"],
    reason: string,
    detail: string,
    facts: string[],
  ) => flags.push({ kind, severity, action, reason, detail, facts });

  for (const item of input.followUps) {
    const overdue = item.date < today;
    add(
      item.key,
      "SOON",
      "Review",
      overdue ? "Follow-up overdue" : "Follow-up due today",
      overdue ? `Due ${shortDate(item.date)} · ${item.detail}` : item.detail,
      [`${item.date}:${overdue ? "overdue" : "due"}`],
    );
  }
  if (!input.active) return flags;

  const late = cycle.filter(isLate);
  if (
    settings.latenessIncidents !== null &&
    counts.lateCount >= settings.latenessIncidents
  ) {
    const last = late.at(-1);
    add(
      "late",
      "URGENT",
      "Coach",
      `${plural(counts.lateCount, "lateness incident")} this cycle`,
      [
        `Flag at ${settings.latenessIncidents}`,
        `${spokenMinutes(counts.lateMinutes)} total`,
        ...(last
          ? [
              `latest ${last.date === plusDays(today, -1) ? "yesterday" : shortDate(last.date)}, ${spokenMinutes(last.late!)}`,
            ]
          : []),
      ].join(" · "),
      [
        ...numbered("incident", counts.lateCount),
        ...late.map((day) => `${day.date}:${Math.round(day.late!)}`),
      ],
    );
  }
  const missing = cycle.filter(isMissing);
  const missingFacts = (rows: DayFacts[]) =>
    rows.map((day) => `${day.date}:${Math.round(day.missing!)}`);
  if (
    settings.missingMinutes !== null &&
    counts.missingMinutes >= settings.missingMinutes
  )
    add(
      "missing",
      "URGENT",
      "Coach",
      `${duration(counts.missingMinutes)} missing this cycle`,
      `Flag at ${duration(settings.missingMinutes)}`,
      missingFacts(missing),
    );
  if (settings.missingDays !== null && settings.missingWindowDays !== null) {
    // Attendance arrives for the previous day, so the window ends yesterday.
    const from = plusDays(today, -settings.missingWindowDays);
    const recent = days.filter(
      (day) => isMissing(day) && day.date >= from && day.date < today,
    );
    if (recent.length >= settings.missingDays)
      add(
        "missing-days",
        "URGENT",
        "Coach",
        `Missing time on ${recent.length} of the last ${settings.missingWindowDays} days`,
        `${duration(recent.reduce((s, day) => s + day.missing!, 0))} total · flag at ${settings.missingDays}`,
        missingFacts(recent),
      );
  }
  const streak = breakStreak(days);
  if (
    settings.breakConsecutive !== null &&
    streak.length >= settings.breakConsecutive
  )
    add(
      "breaks",
      "URGENT",
      "Coach",
      `Break exceeded ${streak.length} days running`,
      `Flag at ${settings.breakConsecutive}`,
      streak.map((day) => day.date),
    );
  const absent = cycle.filter((day) => day.absence);
  if (absent.length) {
    const urgent =
      settings.absentDays !== null && absent.length >= settings.absentDays;
    add(
      "absence",
      urgent ? "URGENT" : "LATER",
      urgent ? "Coach" : "View",
      `${plural(absent.length, "NCNS/AWOL day")} this cycle`,
      absent.map((day) => `${day.absence} ${shortDate(day.date)}`).join(" · ") +
        (urgent ? ` · flag at ${settings.absentDays}` : ""),
      absent.map((day) => `${day.date}:${day.absence}`),
    );
  }
  if (
    settings.qaBelow !== null &&
    qa.average !== null &&
    qa.average < settings.qaBelow
  )
    add(
      "qa",
      "URGENT",
      "Coach",
      `QA cycle average ${qa.average.toFixed(1)}%`,
      `Flag below ${settings.qaBelow}%`,
      qa.evaluations.map((row) => `${row.date}:${row.score}`),
    );
  if (
    qa.connected &&
    settings.noQaDays !== null &&
    (!qa.latest || qa.latest.date <= plusDays(today, -settings.noQaDays))
  )
    add(
      "qa-gap",
      "URGENT",
      "View",
      `No QA evaluation in ${settings.noQaDays} days`,
      qa.latest
        ? `Last evaluation ${shortDate(qa.latest.date)}`
        : "No evaluations recorded",
      [qa.latest?.date ?? "never"],
    );
  const { done, expected } = input.coaching;
  const target = settings.coachingTarget;
  if (done < target && done < expected)
    add(
      "pace",
      "SOON",
      "Coach",
      `${done} of ${target} coachings this cycle`,
      `Expected by today: ${expected.toFixed(1)}`,
      // A new fact only when another whole coaching falls behind.
      numbered("behind", Math.ceil(expected - done)),
    );
  for (const pattern of input.patterns)
    add(
      "pattern-" + pattern.id,
      "LATER",
      "View",
      pattern.text,
      "From recorded attendance",
      pattern.facts,
    );
  return flags;
}

const tokenOf = (facts: string[]) =>
  createHash("sha256").update(JSON.stringify(facts)).digest("hex");

export function flagId(code: string, cycleFrom: string, kind: string) {
  return `${code}|${cycleFrom}|${kind}`;
}

/**
 * Turns candidates into flags. A dismissed flag stays hidden until it has a
 * fact that was not there when the owner dismissed it. Corrections that only
 * remove facts do not bring it back.
 */
export function openFlags(
  code: string,
  cycleFrom: string,
  candidates: Candidate[],
  dismissals: Dismissal[],
) {
  return candidates.flatMap(({ facts, ...candidate }) => {
    const id = flagId(code, cycleFrom, candidate.kind);
    const dismissed = dismissals.find((row) => row.id === id);
    if (dismissed) {
      const seen = new Set(JSON.parse(dismissed.facts) as string[]);
      if (facts.every((fact) => seen.has(fact))) return [];
    }
    return [{ ...candidate, id, code, token: tokenOf(facts), facts }];
  });
}

export function sortFlags<T extends Flag>(flags: T[]) {
  return flags.sort(
    (a, b) =>
      severities.indexOf(a.severity) - severities.indexOf(b.severity) ||
      a.id.localeCompare(b.id),
  );
}

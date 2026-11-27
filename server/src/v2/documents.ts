// Documents the owner copies out: MPR preparation, an escalation draft and
// coaching documentation. They list recorded facts and the owner's own coaching
// entries. Private notes are included only when the owner asks.
import type { ProfileView } from "./profile.js";
import { breakIncident, duration, fullDate, shortDate } from "./templates.js";

const body = (lines: string[]) =>
  lines.length ? lines.join("\n") : "Nothing recorded.";
const section = (title: string, lines: string[]) =>
  [title, body(lines)].join("\n");

const details = (profile: ProfileView) =>
  [
    profile.agent.line,
    profile.agent.hireDate &&
      `hired ${fullDate(profile.agent.hireDate)} (${profile.agent.tenure})`,
  ]
    .filter(Boolean)
    .join(" · ");

/** This cycle's incidents, one line per day. */
export function incidents(profile: ProfileView) {
  return profile.calendar.flatMap((day) => {
    const found = [
      day.late ? `late ${duration(day.late)}` : "",
      day.missing ? `missing ${duration(day.missing)}` : "",
      day.breakExceeded ? breakIncident(day.breakMinutes) : "",
      day.absence ?? "",
      day.correction ? (day.label ?? "") : "",
    ].filter(Boolean);
    return found.length
      ? [`- ${shortDate(day.date)}: ${found.join(", ")}`]
      : [];
  });
}

const coachingLines = (profile: ProfileView) =>
  profile.coaching.timeline.map((row) =>
    [
      `- ${shortDate(row.date)} (${row.type}; ${row.reasons.join(", ")})`,
      `  What happened: ${row.whatHappened}`,
      row.whatWasSaid && `  What was said: ${row.whatWasSaid}`,
      `  Agreed next step: ${row.nextStep}`,
      `  Follow-up: ${row.step.text}`,
      `  Agent acknowledged: ${row.acknowledged ? "yes" : "no"}`,
    ]
      .filter(Boolean)
      .join("\n"),
  );

const notesSection = (profile: ProfileView) =>
  section(
    "Private notes",
    profile.notes.map((note) => `- ${shortDate(note.date)}: ${note.body}`),
  );

/** Placeholders the owner's MPR layout can use. */
export const mprFields = [
  "agent.name",
  "agent.code",
  "agent.details",
  "cycle",
  "date",
  "scorecard",
  "cycles",
  "patterns",
  "coaching",
  "notes",
] as const;

export const defaultMprTemplate = [
  "MPR preparation: {agent.name} ({agent.code})",
  "Cycle {cycle}. Prepared {date}.",
  "{agent.details}",
  "",
  "This cycle (team average in brackets)",
  "{scorecard}",
  "",
  "Recent cycles",
  "{cycles}",
  "",
  "Recorded patterns",
  "{patterns}",
  "",
  "Coaching",
  "{coaching}",
  "",
  "{notes}",
].join("\n");

/** Fills the owner's MPR layout, or the default one. */
export function mprText(profile: ProfileView, includeNotes = false) {
  const template = profile.mprTemplate.trim()
    ? profile.mprTemplate.replace(/\r\n?/g, "\n")
    : defaultMprTemplate;
  const values: Record<(typeof mprFields)[number], string> = {
    "agent.name": profile.agent.name,
    "agent.code": profile.agent.code,
    "agent.details": details(profile),
    cycle: profile.cycleLabel,
    date: shortDate(profile.today),
    scorecard: body(
      profile.scorecard.map(
        (row) =>
          `- ${row.label}: ${row.value} (${row.team})${row.note ? ` · ${row.note}` : ""}`,
      ),
    ),
    cycles: body(
      profile.trends
        .filter((row) => row.reported || row.qa !== null)
        .map(
          (row) =>
            `- From ${row.label}: ${row.lateCount ?? "—"} late (${row.lateMinutes === null ? "—" : duration(row.lateMinutes)}), missing ${row.missingMinutes === null ? "—" : duration(row.missingMinutes)}, QA ${row.qa === null ? "—" : row.qa + "%"}`,
        ),
    ),
    patterns: body(profile.patterns.map((text) => "- " + text)),
    coaching: body(coachingLines(profile)),
    notes: includeNotes ? notesSection(profile) : "",
  };
  // One pass, so braces inside coaching text are never filled in.
  const text = template.replace(
    /\{([a-z]+(?:\.[a-z]+)?)\}/g,
    (whole, name: string) =>
      Object.hasOwn(values, name) ? values[name as keyof typeof values] : whole,
  );
  // Asking for notes includes them even if the layout has no place for them.
  const missingPlace = includeNotes && !template.includes("{notes}");
  return (missingPlace ? `${text}\n\n${values.notes}` : text)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function escalationText(profile: ProfileView, includeNotes = false) {
  const flags = profile.flags
    .filter((flag) => flag.severity === "URGENT")
    .map((flag) => `- ${flag.reason}. ${flag.detail}.`);
  const totals = (
    [
      "lateCount",
      "lateMinutes",
      "missingMinutes",
      "absences",
      "breaks",
    ] as const
  ).map((key) => {
    const row = profile.scorecard.find((item) => item.key === key)!;
    return `- ${row.label} this cycle: ${row.value}${row.note ? ` (${row.note})` : ""}`;
  });
  return [
    [
      `Escalation draft: ${profile.agent.name} (${profile.agent.code})`,
      `Cycle ${profile.cycleLabel}. Prepared ${shortDate(profile.today)}.`,
      details(profile),
    ]
      .filter(Boolean)
      .join("\n"),
    section("What happened", [...incidents(profile), ...flags]),
    // Recorded totals only. What they affected is for the owner to say.
    section("Impact", totals),
    section("What I've already done", coachingLines(profile)),
    "What I need\n",
    ...(includeNotes ? [notesSection(profile)] : []),
  ].join("\n\n");
}

export type Documented = {
  code: string;
  name: string;
  date: string;
  whatHappened: string;
  whatWasSaid: string;
  nextStep: string;
  followUpDate: string | null;
};

/**
 * Coaching entries in the owner's documentation order. A copy names the agent
 * only when it covers more than one. A CSV always does, and keeps ISO dates.
 */
export function documentationTable(rows: Documented[], csv = false) {
  const named = csv || new Set(rows.map((row) => row.code)).size > 1;
  const date = (value: string | null) =>
    !value ? "" : csv ? value : fullDate(value);
  return {
    headers: [
      ...(named ? ["Agent"] : []),
      "Date",
      "What happened",
      "What was said",
      "Agreed next step",
      "Follow-up date",
    ],
    rows: rows.map((row) => [
      ...(named ? [row.name] : []),
      date(row.date),
      row.whatHappened,
      row.whatWasSaid,
      row.nextStep,
      date(row.followUpDate),
    ]),
  };
}

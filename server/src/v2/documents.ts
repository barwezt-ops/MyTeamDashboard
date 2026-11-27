// Documents the owner copies out: MPR preparation and an escalation draft. They
// list recorded facts and the owner's own coaching entries. Private notes are
// included only when the owner asks.
import type { ProfileView } from "./profile.js";
import { breakIncident, duration, shortDate } from "./templates.js";

const section = (title: string, lines: string[]) =>
  [title, ...(lines.length ? lines : ["Nothing recorded."])].join("\n");

const header = (title: string, profile: ProfileView) =>
  [
    `${title}: ${profile.agent.name} (${profile.agent.code})`,
    `Cycle ${profile.cycleLabel}. Prepared ${shortDate(profile.today)}.`,
    [
      profile.agent.line,
      profile.agent.hireDate &&
        `hired ${profile.agent.hireDate} (${profile.agent.tenure})`,
    ]
      .filter(Boolean)
      .join(" · "),
  ].join("\n");

/** This cycle's incidents, one line per day. */
export function incidents(profile: ProfileView) {
  return profile.calendar.flatMap((day) => {
    const found = [
      day.late ? `late ${duration(day.late)}` : "",
      day.missing ? `missing ${duration(day.missing)}` : "",
      day.breakExceeded ? breakIncident(day.breakMinutes) : "",
      day.absence ?? "",
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

const noteLines = (profile: ProfileView) =>
  profile.notes.map((note) => `- ${shortDate(note.date)}: ${note.body}`);

export function mprText(profile: ProfileView, includeNotes = false) {
  return [
    header("MPR preparation", profile),
    section(
      "This cycle (team average in brackets)",
      profile.scorecard.map(
        (row) =>
          `- ${row.label}: ${row.value} (${row.team})${row.note ? ` · ${row.note}` : ""}`,
      ),
    ),
    section(
      "Recent cycles",
      profile.trends
        .filter((row) => row.reported || row.qa !== null)
        .map(
          (row) =>
            `- From ${row.label}: ${row.lateCount ?? "—"} late (${row.lateMinutes === null ? "—" : duration(row.lateMinutes)}), missing ${row.missingMinutes === null ? "—" : duration(row.missingMinutes)}, QA ${row.qa === null ? "—" : row.qa + "%"}`,
        ),
    ),
    section(
      "Recorded patterns",
      profile.patterns.map((text) => "- " + text),
    ),
    section("Coaching", coachingLines(profile)),
    ...(includeNotes ? [section("Private notes", noteLines(profile))] : []),
  ].join("\n\n");
}

export function escalationText(profile: ProfileView, includeNotes = false) {
  return [
    header("Escalation draft", profile),
    section("Recorded incidents this cycle", incidents(profile)),
    section(
      "Open flags",
      profile.flags
        .filter((flag) => flag.severity === "URGENT")
        .map((flag) => `- ${flag.reason}. ${flag.detail}.`),
    ),
    section("Coaching history and follow-up", coachingLines(profile)),
    ...(includeNotes ? [section("Private notes", noteLines(profile))] : []),
    "Requested action:",
  ].join("\n\n");
}

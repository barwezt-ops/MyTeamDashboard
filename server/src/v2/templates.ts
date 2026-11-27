// Every generated sentence in the product comes from this file. Templates take
// real numbers and state facts. They never mention health, motives or personal
// life, and nothing here calls a language model.

export function minutes(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number")
    return Number.isFinite(value) && value >= 0 ? value : null;
  const text = String(value).trim();
  if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text);
  const clock = /^(\d+):(\d{2})(?::(\d{2}))?$/.exec(text);
  if (clock && Number(clock[2]) < 60 && Number(clock[3] ?? 0) < 60)
    return (
      Number(clock[1]) * 60 + Number(clock[2]) + Number(clock[3] ?? 0) / 60
    );
  const spelled = /^(?:(\d+)h\s*)?(?:(\d+)m)$/.exec(text);
  return spelled ? Number(spelled[1] ?? 0) * 60 + Number(spelled[2]) : null;
}

export function duration(value: number | null) {
  if (value === null) return "Not reported";
  const n = Math.round(value);
  return n >= 60 ? `${Math.floor(n / 60)}h ${n % 60}m` : `${n}m`;
}

const words = "zero one two three four five six seven eight nine ten".split(
  " ",
);
export const numberWord = (n: number) => words[n] ?? String(n);
export const sentenceCase = (text: string) =>
  text.charAt(0).toUpperCase() + text.slice(1);
export const plural = (n: number, one: string, many = one + "s") =>
  `${n} ${n === 1 ? one : many}`;
const people = (n: number) =>
  `${sentenceCase(numberWord(n))} ${n === 1 ? "person" : "people"}`;
export const spokenMinutes = (value: number) => {
  const n = Math.round(value);
  return n < 120 ? plural(n, "minute") : duration(n);
};

/** "16:00" becomes "4 o'clock", "15:45" becomes "3:45". */
export function spokenTime(time: string) {
  const [hour, minute] = time.split(":").map(Number);
  const twelve = hour % 12 || 12;
  return minute
    ? `${twelve}:${String(minute).padStart(2, "0")}`
    : `${twelve} o'clock`;
}

export function homeSummary(input: {
  urgentPeople: number;
  soonPeople: number;
  /** Start time of today's busiest shift, when the schedule has one. */
  rush?: string | null;
}) {
  const { urgentPeople: urgent, soonPeople: soon, rush } = input;
  if (!urgent)
    return soon
      ? `Nothing urgent. ${people(soon)} ${soon === 1 ? "has" : "have"} something due soon.`
      : "Nothing urgent and nothing due. The team is on track.";
  const first = `${people(urgent)} ${urgent === 1 ? "needs" : "need"} you${rush ? ` before the ${spokenTime(rush)} rush` : " today"}.`;
  return soon
    ? `${first} ${sentenceCase(numberWord(soon))} more ${soon === 1 ? "person has" : "people have"} something due soon.`
    : `${first} Everyone else is on track.`;
}

/** `series` is oldest first and ends with the latest reported day. */
export function latenessCaption(
  series: { date: string; minutes: number | null }[],
  yesterday: string,
) {
  const reported = series.filter(
    (day): day is { date: string; minutes: number } => day.minutes !== null,
  );
  if (!reported.length) return "No attendance reported for these days yet.";
  const total = (days: typeof series) =>
    days.reduce((s, day) => s + (day.minutes ?? 0), 0);
  const recent = total(series.slice(-7));
  const before = total(series.slice(-14, -7));
  const worst = reported.reduce((a, b) => (b.minutes >= a.minutes ? b : a));
  if (!worst.minutes) return "No lateness recorded on any reported day.";
  const comparable = series.slice(-14, -7).some((day) => day.minutes !== null);
  const direction = !comparable
    ? `${spokenMinutes(recent)} late this week.`
    : recent > before
      ? "Climbing this week."
      : recent < before
        ? "Easing this week."
        : "Level with last week.";
  const when =
    worst.date === yesterday ? "yesterday" : "on " + shortDate(worst.date);
  return `${direction} Worst day was ${when}, ${spokenMinutes(worst.minutes)}.`;
}

export function perfectCaption(count: number) {
  if (!count) return "Nobody has perfect attendance yet this cycle.";
  return `${people(count)} ${count === 1 ? "has" : "have"} perfect attendance this cycle.`;
}

/** Where the team stands against the coachings due by now. */
export function coachingStanding(input: {
  behind: number;
  expected: number;
  firstDue: string;
}) {
  if (input.behind) return `${plural(input.behind, "agent")} behind pace.`;
  return input.expected
    ? "Everyone is on pace."
    : `No coaching is due yet. The first is due on ${shortDate(input.firstDue)}.`;
}

export function coachingPace(done: number, due: number, daysLeft: number) {
  const left = Math.max(0, due - done);
  if (!left) return "Every coaching for this cycle is done.";
  if (daysLeft <= 0)
    return `${plural(left, "coaching")} left and no days remaining.`;
  const perDay = left / daysLeft;
  return `${plural(left, "coaching")} to go in ${plural(daysLeft, "day")}: ${
    perDay <= 1 ? "one a day or fewer" : `about ${Math.ceil(perDay)} a day`
  }.`;
}

/** "Avery S." keeps rows short without losing who is meant. */
export function shortName(agent: { fullName: string; firstName: string }) {
  const parts = agent.fullName.trim().split(/\s+/);
  const first = agent.firstName || parts[0] || "";
  return parts.length > 1 ? `${first} ${parts[parts.length - 1][0]}.` : first;
}

/** "4:01 PM" from a 24-hour "16:01". */
export function clockTime(time: string | null) {
  if (!time) return null;
  const [hour, minute] = time.split(":").map(Number);
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
}

export function weekCaption(exceptions: number, days: number) {
  return exceptions
    ? `${plural(exceptions, "late, missing or absent day")} in the last ${days} days.`
    : `No late, missing or absent days in the last ${days} days.`;
}

export function shoutOut(names: string[], from: string, to: string) {
  return names.length
    ? `Shout-out: ${names.join(", ")}. Perfect attendance from ${shortDate(from)} to ${shortDate(to)}.`
    : "";
}

/** How far over an exceeded break went, when the source says. */
export function breakOver(minutes: number | null) {
  if (!minutes) return "Exceeded";
  return minutes < 0.5 ? "<1m" : duration(minutes);
}
/** One exceeded break inside a list of a day's incidents. */
export const breakIncident = (minutes: number | null) =>
  minutes ? `break exceeded by ${breakOver(minutes)}` : "break exceeded";
/** Added after a count of exceeded breaks. */
export const overInTotal = (minutes: number) =>
  minutes ? `${breakOver(minutes)} over in total` : "";

export const behindPace = (count: number) =>
  `${plural(count, "agent")} behind coaching pace`;

export function attendanceSummary(totals: {
  lateDays: number;
  lateMinutes: number;
  missingDays: number;
  reported: number;
}) {
  if (!totals.reported) return "No attendance reported for this cycle yet.";
  const late = totals.lateDays
    ? `${plural(totals.lateDays, "late day")}, ${spokenMinutes(totals.lateMinutes)} in total`
    : "No late days";
  const missing = totals.missingDays
    ? `${plural(totals.missingDays, "day")} with missing time`
    : "no missing time";
  return `${late}; ${missing}.`;
}

export function shortDate(date: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(date + "T00:00:00Z"));
}
export function weekdayDate(date: string) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    timeZone: "UTC",
  })
    .format(new Date(date + "T00:00:00Z"))
    .replace(",", "");
}

// Factual patterns shown as LATER items. They report what was recorded and how
// often, nothing else.
import { plusDays, weekday, weekdays } from "../parse/normalize.js";
import { isLate, isMissing, type DayFacts } from "./facts.js";

export type Pattern = { id: string; text: string; facts: string[] };

/** Recorded working days with an exceeded break, counted back from the latest. */
export function breakStreak(days: DayFacts[]) {
  const worked = days.filter((day) => day.status === "Present");
  const streak: DayFacts[] = [];
  for (let i = worked.length - 1; i >= 0 && worked[i].breakExceeded; i--)
    streak.unshift(worked[i]);
  return streak;
}

/**
 * `days` is oldest first across recent cycles. `isOff` says whether a date was
 * an OFF day for this agent.
 */
export function findPatterns(
  days: DayFacts[],
  cycle: DayFacts[],
  isOff: (date: string) => boolean,
): Pattern[] {
  const patterns: Pattern[] = [];
  const worked = days.filter((day) => day.status === "Present" || isLate(day));
  for (let w = 0; w < 7; w++) {
    const recent = worked.filter((day) => weekday(day.date) === w).slice(-5);
    const hits = recent.filter(isLate);
    // Show a weekday only when lateness was recorded on most recent ones.
    if (hits.length >= 3 && hits.length * 2 > recent.length)
      patterns.push({
        id: "late-" + weekdays[w].toLowerCase(),
        text: `Late ${hits.length} of the last ${recent.length} ${weekdays[w]}s.`,
        facts: hits.map((day) => day.date),
      });
  }
  const afterOff = cycle.filter(
    (day) => isMissing(day) && isOff(plusDays(day.date, -1)),
  );
  if (afterOff.length >= 2)
    patterns.push({
      id: "missing-after-off",
      text: `Missing time ${afterOff.length === 2 ? "twice" : `${afterOff.length} times`} right after an OFF day this cycle.`,
      facts: afterOff.map((day) => day.date),
    });
  const streak = breakStreak(days);
  if (streak.length >= 2)
    patterns.push({
      id: "break-streak",
      text: `Break exceeded ${streak.length} days running.`,
      facts: streak.map((day) => day.date),
    });
  return patterns;
}

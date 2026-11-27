// Cycle utilities. Dates are Cairo calendar dates in ISO form, so plain
// day arithmetic is safe across daylight-saving changes.
import { coachingCycle, plusDays } from "../parse/normalize.js";

export type Range = { from: string; to: string };

export const daysApart = (from: string, to: string) =>
  Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

export function datesBetween(from: string, to: string) {
  const days: string[] = [];
  for (let day = from; day <= to; day = plusDays(day, 1)) days.push(day);
  return days;
}

/** The cycle containing `asOf`, with how much of it has passed on `today`. */
export function cycleInfo(asOf: string, today: string, startDay: number) {
  const range = coachingCycle(asOf, startDay);
  const totalDays = daysApart(range.from, range.to) + 1;
  const elapsed = Math.max(
    0,
    Math.min(totalDays, daysApart(range.from, today) + 1),
  );
  return { ...range, totalDays, elapsed, daysLeft: totalDays - elapsed };
}

/**
 * Coachings per agent that are due by now. One is due only once a whole one is,
 * so with a target of two the first falls due mid-cycle and the second on the
 * last day.
 */
export const expectedCoachings = (
  target: number,
  elapsed: number,
  totalDays: number,
) => Math.floor((target * elapsed) / totalDays);

/** The day the first coaching of a cycle falls due. */
export const firstCoachingDue = (
  target: number,
  range: { from: string; totalDays: number },
) => plusDays(range.from, Math.ceil(range.totalDays / target) - 1);

export const previousCycle = (range: Range, startDay: number) =>
  coachingCycle(plusDays(range.from, -1), startDay);

/** Newest first, starting with the cycle containing `asOf`. */
export function recentCycles(asOf: string, startDay: number, count: number) {
  const cycles: Range[] = [coachingCycle(asOf, startDay)];
  while (cycles.length < count)
    cycles.push(previousCycle(cycles[cycles.length - 1], startDay));
  return cycles;
}

export const within = (date: string, range: Range) =>
  date >= range.from && date <= range.to;

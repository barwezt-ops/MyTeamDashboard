// Whether an agreed next step was kept, worked out from recorded attendance for
// the measure and target the owner entered with the coaching.
import { isLate, isMissing, sum, type DayFacts } from "./facts.js";

export type Measure = "none" | "lateness" | "missing" | "breaks";
export type Outcome = {
  result: "kept" | "not kept" | "pending" | "no data";
  /** Lateness incidents, missing minutes or exceeded-break days. */
  value: number;
  target: number;
  /** Minutes over, for the exceeded-break measure when reported. */
  minutes?: number;
};

export function stepOutcome(
  coaching: { date: string; measure: string; target: number | null },
  followUpDate: string | null,
  days: DayFacts[],
): Outcome | null {
  if (coaching.measure === "none" || coaching.target === null || !followUpDate)
    return null;
  const window = days.filter(
    (day) => day.date > coaching.date && day.date <= followUpDate,
  );
  const value =
    coaching.measure === "lateness"
      ? window.filter(isLate).length
      : coaching.measure === "missing"
        ? Math.round(sum(window.filter(isMissing), "missing"))
        : window.filter((day) => day.breakExceeded).length;
  const complete = (days.at(-1)?.date ?? "") >= followUpDate;
  // Every measure only grows, so exceeding the target is final.
  const result =
    value > coaching.target
      ? "not kept"
      : !complete
        ? "pending"
        : window.length
          ? "kept"
          : "no data";
  const over = coaching.measure === "breaks" ? sum(window, "breakMinutes") : 0;
  return {
    result,
    value,
    target: coaching.target,
    ...(over ? { minutes: over } : {}),
  };
}

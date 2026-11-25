import {
  dateAllowed,
  dayKey,
  finding,
  skip,
  sourceIndex,
  type RuleContext,
} from "./context.js";

const zeroDurations = new Set(["0", "0:00", "00:00", "0:00:00", "00:00:00"]);

export function d4(ctx: RuleContext) {
  const byKey = sourceIndex(ctx.schedule);
  return ctx.attendance.flatMap((actual) =>
    dateAllowed(ctx, actual.date) &&
    actual.missing?.trim() &&
    !zeroDurations.has(actual.missing.trim()) &&
    !skip(byKey.get(dayKey(actual.code, actual.date)), actual)
      ? [finding(actual.code, actual.date, "D4", actual.missing, "attendance")]
      : [],
  );
}

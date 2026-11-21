import {
  dateAllowed,
  dayKey,
  finding,
  skip,
  sourceIndex,
  type RuleContext,
} from "./context.js";
export function d4(ctx: RuleContext) {
  const byKey = sourceIndex(ctx.schedule);
  return ctx.attendance.flatMap((actual) =>
    dateAllowed(ctx, actual.date) &&
    actual.missing?.trim() &&
    !skip(byKey.get(dayKey(actual.code, actual.date)), actual)
      ? [finding(actual.code, actual.date, "D4", actual.missing, "attendance")]
      : [],
  );
}

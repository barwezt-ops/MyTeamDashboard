import {
  absence,
  dateAllowed,
  dayKey,
  finding,
  skip,
  sourceIndex,
  type RuleContext,
} from "./context.js";
export function d2(ctx: RuleContext) {
  const byKey = sourceIndex(ctx.schedule);
  return ctx.attendance.flatMap((actual) => {
    const row = byKey.get(dayKey(actual.code, actual.date));
    return dateAllowed(ctx, actual.date) &&
      row?.status === "Scheduled" &&
      !skip(row, actual) &&
      absence.has(actual.status)
      ? [
          finding(
            actual.code,
            actual.date,
            "D2",
            "Schedule shows " +
              row.shiftStart +
              ", attendance shows " +
              actual.status,
            "attendance",
          ),
        ]
      : [];
  });
}

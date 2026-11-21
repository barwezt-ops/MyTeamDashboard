import {
  dateAllowed,
  dayKey,
  finding,
  skip,
  sourceIndex,
  type RuleContext,
} from "./context.js";
export function d1(ctx: RuleContext) {
  const byKey = sourceIndex(ctx.attendance);
  const dates = new Set(ctx.attendance.map((row) => row.date));
  return ctx.schedule.flatMap((row) => {
    const actual = byKey.get(dayKey(row.code, row.date));
    return dateAllowed(ctx, row.date) &&
      dates.has(row.date) &&
      row.status === "Scheduled" &&
      !skip(row, actual) &&
      !actual?.raw.trim()
      ? [
          finding(
            row.code,
            row.date,
            "D1",
            "No attendance record",
            "attendance",
          ),
        ]
      : [];
  });
}

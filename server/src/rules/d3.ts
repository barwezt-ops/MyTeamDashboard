import {
  dateAllowed,
  dayKey,
  finding,
  leave,
  sourceIndex,
  type RuleContext,
} from "./context.js";
export function d3(ctx: RuleContext) {
  const byKey = sourceIndex(ctx.schedule);
  return ctx.attendance.flatMap((actual) => {
    const row = byKey.get(dayKey(actual.code, actual.date));
    return dateAllowed(ctx, actual.date) &&
      row &&
      leave.has(row.status) &&
      actual.status === "Present"
      ? [
          finding(
            actual.code,
            actual.date,
            "D3",
            "Schedule shows " + row.status + ", attendance shows Present",
            "attendance",
          ),
        ]
      : [];
  });
}

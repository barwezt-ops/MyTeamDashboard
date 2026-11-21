import { plusDays } from "../parse/normalize.js";
import {
  absence,
  dayKey,
  finding,
  skip,
  sourceIndex,
  type RuleContext,
} from "./context.js";
export function d7(ctx: RuleContext) {
  const schedule = sourceIndex(ctx.schedule);
  const attendance = sourceIndex(ctx.attendance);
  const yesterday = plusDays(ctx.today, -1);
  return ctx.schedule.flatMap((row) => {
    if (
      row.date !== ctx.today ||
      row.status !== "Scheduled" ||
      skip(row, attendance.get(dayKey(row.code, row.date)))
    )
      return [];
    const key = dayKey(row.code, yesterday);
    const before = schedule.get(key);
    const actual = attendance.get(key);
    if (skip(before, actual)) return [];
    const status = [actual?.status, before?.status].find(
      (status) => status && absence.has(status),
    );
    return status
      ? [
          finding(
            row.code,
            ctx.today,
            "D7",
            "Confirm return (was " + status + " yesterday)",
            "schedule",
            "info",
          ),
        ]
      : [];
  });
}

import { plusDays } from "../parse/normalize.js";
import {
  dayKey,
  finding,
  skip,
  sourceIndex,
  type RuleContext,
} from "./context.js";
export function d6(ctx: RuleContext) {
  const active = new Set(
    ctx.agents.filter((agent) => agent.active).map((agent) => agent.code),
  );
  const attendance = sourceIndex(ctx.attendance);
  const end = plusDays(ctx.today, 7);
  return ctx.schedule.flatMap((row) =>
    row.status === "Unknown" &&
    row.date >= ctx.from &&
    row.date <= end &&
    active.has(row.code) &&
    !skip(row, attendance.get(dayKey(row.code, row.date)))
      ? [
          finding(
            row.code,
            row.date,
            "D6",
            'Schedule cell empty/invalid ("' + row.raw + '")',
            "schedule",
          ),
        ]
      : [],
  );
}

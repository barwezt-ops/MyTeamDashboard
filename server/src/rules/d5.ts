import {
  dayKey,
  finding,
  skip,
  sourceIndex,
  type RuleContext,
} from "./context.js";
export function d5(ctx: RuleContext) {
  const members = ctx.scheduleMembers;
  if (!members) return [];
  const schedule = sourceIndex(ctx.schedule);
  const attendance = sourceIndex(ctx.attendance);
  return ctx.agents.flatMap((agent) => {
    const key = dayKey(agent.code, ctx.today);
    if (skip(schedule.get(key), attendance.get(key))) return [];
    const scheduled = members.has(agent.code);
    if (agent.active && !scheduled)
      return [
        finding(agent.code, ctx.today, "D5", "Not on schedule", "roster"),
      ];
    if (!agent.active && scheduled)
      return [
        finding(
          agent.code,
          ctx.today,
          "D5",
          "On schedule but not on team roster",
          "roster",
        ),
      ];
    return [];
  });
}

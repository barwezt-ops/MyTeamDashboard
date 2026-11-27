import {
  statuses,
  trendStatuses,
  type Agent,
  type AttendanceDay,
  type DiscrepancyRow,
  type ScheduleDay,
  type Status,
  type TrendsData,
} from "./dto.js";
import type { Config } from "../config.js";
import { plusDays } from "../parse/normalize.js";
import { dayKey } from "../rules/context.js";

function zeroCounts<T extends Status>(labels: readonly T[]) {
  return Object.fromEntries(labels.map((label) => [label, 0])) as Record<
    T,
    number
  >;
}
export function calculateTrends(
  agents: Agent[],
  schedule: ScheduleDay[],
  attendance: AttendanceDay[],
  discrepancies: DiscrepancyRow[],
  from: string,
  to: string,
  today: string,
  thresholds: Config["thresholds"],
): TrendsData {
  const totals = zeroCounts(trendStatuses);
  const actual = new Map(
    schedule.map((row) => [dayKey(row.code, row.date), row]),
  );
  for (const row of attendance)
    if (row.status !== "Unknown") {
      const key = dayKey(row.code, row.date);
      if (
        !row.correction?.label &&
        actual.get(key)?.status === "Off Day" &&
        row.status !== "Present"
      )
        continue;
      actual.set(key, { ...row, shiftStart: null });
    }
  const daily = new Map<string, TrendsData["daily"][number]>();
  for (let date = from; date <= to; date = plusDays(date, 1))
    daily.set(date, { date, ...zeroCounts(statuses) });
  const byCode = new Map(
    agents.map((agent) => {
      const result = {
        code: agent.code,
        firstName: agent.firstName,
        counts: zeroCounts(trendStatuses),
        discrepancies: 0,
        badges: [] as TrendsData["agents"][number]["badges"],
      };
      return [agent.code, result];
    }),
  );
  const thresholdCounts = new Map<string, Map<Status, number>>();
  for (const row of actual.values()) {
    const agent = byCode.get(row.code);
    if (!agent) continue;
    const counts = daily.get(row.date);
    if (counts) {
      counts[row.status]++;
      if (Object.hasOwn(totals, row.status)) {
        const status = row.status as keyof typeof totals;
        totals[status]++;
        agent.counts[status]++;
      }
    }
    const limit = thresholds[row.status];
    if (
      limit &&
      row.date >= plusDays(today, 1 - limit.days) &&
      row.date <= today
    ) {
      const counts = thresholdCounts.get(row.code) ?? new Map();
      counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
      thresholdCounts.set(row.code, counts);
    }
  }
  for (const row of discrepancies) {
    const agent = byCode.get(row.code);
    if (agent) agent.discrepancies++;
  }
  for (const agent of byCode.values()) {
    for (const [status, count] of thresholdCounts.get(agent.code) ?? []) {
      const limit = thresholds[status]!;
      if (count >= limit.count)
        agent.badges.push({
          status: status as Status,
          count,
          days: limit.days,
        });
    }
  }
  return { agents: [...byCode.values()], totals, daily: [...daily.values()] };
}

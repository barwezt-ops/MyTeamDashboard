// The Queues screen: today's board, two weeks of coverage, upcoming leave and
// line changes.
import { plusDays } from "../parse/normalize.js";
import { datesBetween } from "./cycle.js";
import type { DashboardData } from "./data.js";
import { onLeave } from "./heat.js";
import { planFor, queuesFor, working } from "./queues.js";
import * as say from "./templates.js";

const leaveLabel = (status: string) =>
  status === "PTO"
    ? "Annual"
    : status === "UPL"
      ? "Unpaid"
      : status.replace("UPL", "unpaid");

/** Consecutive days of the same leave become one entry. */
export function upcomingLeave(data: DashboardData) {
  return data.agents
    .filter((agent) => agent.active)
    .flatMap((agent) => {
      const spans: {
        code: string;
        name: string;
        line: string | null;
        type: string;
        from: string;
        to: string;
        days: number;
      }[] = [];
      for (const day of agent.upcoming) {
        const status = day.schedule?.status;
        if (!status || !onLeave(status)) continue;
        const type = leaveLabel(status);
        const last = spans.at(-1);
        if (last?.type === type && plusDays(last.to, 1) === day.date) {
          last.to = day.date;
          last.days++;
        } else
          spans.push({
            code: agent.code,
            name: say.shortName(agent),
            line: agent.line,
            type,
            from: day.date,
            to: day.date,
            days: 1,
          });
      }
      return spans;
    })
    .sort(
      (a, b) => a.from.localeCompare(b.from) || a.name.localeCompare(b.name),
    );
}

export function lineChanges(data: DashboardData) {
  const names = new Map(
    data.agents.map((agent) => [agent.code, say.shortName(agent)]),
  );
  const previous = new Map<string, DashboardData["lineHistory"][number]>();
  const changes = [];
  for (const row of data.lineHistory) {
    const before = previous.get(row.code);
    previous.set(row.code, row);
    // The first read of the tab is a starting point, not a change.
    if (!before) continue;
    const parts = [
      before.line !== row.line && `moved from ${before.line} to ${row.line}`,
      before.account !== row.account &&
        `account changed from ${before.account || "none"} to ${row.account || "none"}`,
      before.template !== row.template && "weekly shift template changed",
    ].filter(Boolean) as string[];
    if (parts.length)
      changes.push({
        key: row.id,
        code: row.code,
        name: names.get(row.code)!,
        date: row.changed_on,
        text: say.sentenceCase(parts.join("; ")) + ".",
      });
  }
  return changes.reverse();
}

export function boardView(data: DashboardData) {
  const { today } = data;
  const dates = datesBetween(today, plusDays(today, 13));
  const byDate = dates.map((date) => planFor(data, date));
  const board = queuesFor(data, today);
  const coverage = board.map(({ line, baseline }) => ({
    line,
    baseline,
    days: dates.map((date, i) => {
      const plan = byDate[i].filter((row) => row.line === line);
      const scheduled = plan.filter((row) => working(row.state)).length;
      return {
        date,
        scheduled,
        short: baseline === null ? 0 : Math.max(0, baseline - scheduled),
        // Days filled from the weekly template rather than the dated schedule.
        estimated: plan.some((row) => row.fromTemplate),
        unknown:
          plan.length > 0 && plan.every((row) => row.state === "not scheduled"),
      };
    }),
  }));
  const gaps = coverage.reduce(
    (total, row) => total + row.days.filter((day) => day.short > 0).length,
    0,
  );
  const anyBaseline = coverage.some((row) => row.baseline !== null);
  const scheduled = board.reduce((total, queue) => total + queue.scheduled, 0);
  return {
    today,
    summary: `${say.plural(scheduled, "person", "people")} scheduled today.${
      anyBaseline
        ? gaps
          ? ` ${say.plural(gaps, "short line-day")} in the next two weeks.`
          : " No gaps against your baselines in the next two weeks."
        : ""
    }`,
    board,
    dates,
    coverage,
    anyBaseline,
    leave: upcomingLeave(data),
    changes: lineChanges(data),
    hasLines: data.lineHistory.length > 0,
  };
}
export type BoardView = ReturnType<typeof boardView>;

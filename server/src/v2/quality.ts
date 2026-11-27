// Quality scores per agent. Only the approved QA fields exist: date, score and
// evaluation form.
import { daysApart, within } from "./cycle.js";
import type { DashboardData } from "./data.js";
import { cycleLabel } from "./grid.js";
import * as say from "./templates.js";

/** Display bands for the distribution. They carry no judgement. */
export const bands = [
  { label: "Under 80%", from: 0 },
  { label: "80 to 84%", from: 80 },
  { label: "85 to 89%", from: 85 },
  { label: "90 to 94%", from: 90 },
  { label: "95 to 100%", from: 95 },
];

const mean = (values: number[]) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;

export function qualityView(data: DashboardData) {
  const { today, settings } = data;
  const rows = data.agents
    .filter((agent) => agent.active)
    .map((agent) => {
      const latest = agent.qa.at(-1) ?? null;
      const daysSince = latest ? daysApart(latest.date, today) : null;
      return {
        code: agent.code,
        name: say.shortName(agent),
        latest: latest?.score ?? null,
        latestDate: latest?.date ?? null,
        form: latest?.form ?? "",
        daysSince,
        average: agent.qaAverage,
        previous: agent.priorQaAverage,
        change:
          agent.qaAverage !== null && agent.priorQaAverage !== null
            ? Math.round((agent.qaAverage - agent.priorQaAverage) * 10) / 10
            : null,
        evaluations: agent.qa.filter((row) => within(row.date, data.cycle))
          .length,
        // Oldest first, for the small trend.
        recent: agent.qa
          .slice(-6)
          .map((row) => ({ date: row.date, score: row.score })),
        // Marked only once the owner has set a number of days.
        stale:
          data.qaConnected &&
          settings.noQaDays !== null &&
          (daysSince === null || daysSince >= settings.noQaDays),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  const averages = rows.flatMap((row) =>
    row.average === null ? [] : [row.average],
  );
  const team = mean(averages);
  const distribution = bands.map((band, i) => ({
    label: band.label,
    count: averages.filter(
      (value) => value >= band.from && value < (bands[i + 1]?.from ?? Infinity),
    ).length,
  }));
  const stale = rows.filter((row) => row.stale).length;
  return {
    connected: data.qaConnected,
    hasScores: rows.some((row) => row.latest !== null),
    cycle: cycleLabel(data.cycle),
    noQaDays: settings.noQaDays,
    team,
    summary:
      team === null
        ? data.qaConnected
          ? "No evaluations in this cycle yet."
          : "QA is not connected yet."
        : `Team average ${team.toFixed(1)}% across ${say.plural(averages.length, "evaluated agent")}.${
            stale
              ? ` ${say.plural(stale, "agent")} without a recent evaluation.`
              : ""
          }`,
    distribution,
    rows,
  };
}
export type QualityView = ReturnType<typeof qualityView>;

// Who is planned on each line for a date.
import type { Status } from "../api/dto.js";
import { excluded } from "../parse/status.js";
import type { DashboardData } from "./data.js";
import { shortName } from "./templates.js";

export const noLine = "No line recorded";

export type PlanState =
  | "on"
  | "off"
  | "annual"
  | "sick"
  | "casual"
  | "unpaid"
  | "half day"
  | "absent"
  | "not scheduled";

export function planState(status: Status | undefined): PlanState {
  if (!status) return "not scheduled";
  if (status.includes("Half")) return "half day";
  switch (status) {
    case "Scheduled":
    case "Present":
      return "on";
    case "Off Day":
      return "off";
    case "PTO":
      return "annual";
    case "Sick":
      return "sick";
    case "Casual":
      return "casual";
    case "UPL":
      return "unpaid";
    case "Absent":
      return "absent";
    default:
      return "not scheduled";
  }
}
/** A half day still puts the agent on the floor for part of the shift. */
export const working = (state: PlanState) =>
  state === "on" || state === "half day";

/** Active team members who can be scheduled on a date. */
export function planFor(data: DashboardData, date: string) {
  return data.agents.flatMap((agent) => {
    if (!agent.active) return [];
    const day =
      agent.next14.find((row) => row.date === date) ??
      agent.calendar.find((row) => row.date === date);
    const planned = day?.schedule ?? null;
    if (excluded(planned?.status)) return [];
    return [
      {
        code: agent.code,
        name: shortName(agent),
        line: agent.line ?? noLine,
        state: planState(planned?.status),
        shiftStart: planned?.shiftStart ?? null,
        fromTemplate: planned?.source === "template",
      },
    ];
  });
}

export function queuesFor(data: DashboardData, date: string) {
  const plan = planFor(data, date);
  const lines = [
    ...new Set([
      ...plan.map((row) => row.line),
      ...Object.keys(data.settings.staffing),
    ]),
  ].sort((a, b) => (a === noLine ? 1 : b === noLine ? -1 : a.localeCompare(b)));
  return lines.map((line) => {
    const agents = plan
      .filter((row) => row.line === line)
      .sort(
        (a, b) =>
          Number(!working(a.state)) - Number(!working(b.state)) ||
          a.name.localeCompare(b.name),
      );
    const scheduled = agents.filter((row) => working(row.state)).length;
    // Gaps are shown only against a baseline the owner set for the line.
    const baseline = data.settings.staffing[line] ?? null;
    return {
      line,
      scheduled,
      total: agents.length,
      baseline,
      short: baseline === null ? 0 : Math.max(0, baseline - scheduled),
      agents,
    };
  });
}

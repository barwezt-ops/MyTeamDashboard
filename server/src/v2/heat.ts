// How one agent day is coloured, shared by the week view and the attendance
// grid. Every colour has a text label.
import { excluded } from "../parse/status.js";
import type { Status } from "../api/dto.js";
import { isLate, isMissing, type DayFacts } from "./facts.js";

export const heatStatuses = [
  "Present",
  "Late",
  "Missing",
  "Off",
  "Leave / sick",
  "Absent",
  "Scheduled",
] as const;
export type HeatStatus = (typeof heatStatuses)[number];

export const onLeave = (status: Status) =>
  status === "PTO" ||
  status === "UPL" ||
  status === "Sick" ||
  status === "Casual" ||
  status.includes("Half");

/** Null means nothing is recorded or planned for the day. */
export function heatStatus(
  attendance: DayFacts | null,
  planned: Status | null,
): HeatStatus | null {
  if (attendance) {
    const { status } = attendance;
    if (status === "Absent") return "Absent";
    if (isMissing(attendance)) return "Missing";
    if (isLate(attendance)) return "Late";
    if (status === "Present") return "Present";
    if (onLeave(status)) return "Leave / sick";
    if (status === "Off Day" || excluded(status)) return "Off";
    return null;
  }
  if (!planned) return null;
  if (planned === "Off Day" || excluded(planned)) return "Off";
  if (onLeave(planned)) return "Leave / sick";
  // Planned, with no attendance recorded: shown as an outline.
  return planned === "Scheduled" ? "Scheduled" : null;
}

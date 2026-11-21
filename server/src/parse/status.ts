import type { Status } from "../api/dto.js";
import { labelOf } from "./normalize.js";
export function parseStatus(
  raw: string,
  map: Record<string, Status>,
): { status: Status; shiftStart: string | null } {
  const label = labelOf(raw);
  const shift = /^\d{1,2}:\d{2}/.exec(label)?.[0];
  if (shift) return { status: "Scheduled", shiftStart: shift.padStart(5, "0") };
  return {
    status: label && Object.hasOwn(map, label) ? map[label] : "Unknown",
    shiftStart: null,
  };
}
export const excluded = (status: Status | undefined) =>
  status === "On Hold" || status === "Not Hired";

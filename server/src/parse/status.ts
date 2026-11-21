import type { Status } from "../api/dto.js";
import { labelOf } from "./normalize.js";
export function parseStatus(
  raw: string,
  map: Record<string, Status>,
): { status: Status; shiftStart: string | null } {
  const label = labelOf(raw);
  const time =
    /^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(am|pm)\b)?(?=$|[\s–—-])/.exec(label);
  if (time) {
    const [, hours, minutes, seconds = "00", meridiem] = time;
    const hour = Number(hours);
    const validHour = meridiem ? hour >= 1 && hour <= 12 : hour < 24;
    if (validHour && Number(minutes) < 60 && Number(seconds) < 60) {
      const hour24 = meridiem
        ? (hour % 12) + (meridiem === "pm" ? 12 : 0)
        : hour;
      return {
        status: "Scheduled",
        shiftStart: String(hour24).padStart(2, "0") + ":" + minutes,
      };
    }
  }
  return {
    status: label && Object.hasOwn(map, label) ? map[label] : "Unknown",
    shiftStart: null,
  };
}
export const excluded = (status: Status | undefined) =>
  status === "On Hold" || status === "Not Hired";

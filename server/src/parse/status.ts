import type { Status } from "../api/dto.js";
import { labelOf } from "./normalize.js";
export const attendancePasteStatusMap: Record<string, Status> = {
  "active - site": "Present",
  "active - remote": "Present",
  off: "Off Day",
  "public holiday": "Off Day",
  dropped: "Inactive",
  resigned: "Inactive",
  terminated: "Inactive",
  "not hired": "Not Hired",
  "on hold": "On Hold",
  sick: "Sick",
  casual: "Casual",
  annual: "PTO",
  upl: "UPL",
  awol: "Absent",
  ncns: "Absent",
  maternity: "PTO",
  "marriage leave": "PTO",
  "forced upl": "UPL",
  "forced annual": "PTO",
  "1st half ann": "1st Half Annual",
  "1st half annual": "1st Half Annual",
  "2nd half ann": "2nd Half Annual",
  "2nd half annual": "2nd Half Annual",
  "1st half upl": "1st Half UPL",
  "2nd half upl": "2nd Half UPL",
  "1st half forced ann": "1st Half Forced Annual",
  "1st half forced annual": "1st Half Forced Annual",
  "2nd half forced ann": "2nd Half Forced Annual",
  "2nd half forced annual": "2nd Half Forced Annual",
  "1st half forced upl": "1st Half Forced UPL",
  "2nd half forced upl": "2nd Half Forced UPL",
};
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
  status === "On Hold" || status === "Not Hired" || status === "Inactive";

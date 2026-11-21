import type { Status } from "../../server/src/api/dto";
export const statusColors: Record<Status, string> = {
  Scheduled: "#0d896b",
  Present: "#20a478",
  "Off Day": "#81919d",
  PTO: "#4275d2",
  UPL: "#8456c6",
  Sick: "#c5840e",
  Casual: "#dc681f",
  Absent: "#d3485b",
  "On Hold": "#687687",
  "Not Hired": "#687687",
  Unknown: "#cf4f7e",
};
export const statusSlugs: Record<Status, string> = {
  Scheduled: "scheduled",
  Present: "present",
  "Off Day": "off",
  PTO: "pto",
  UPL: "upl",
  Sick: "sick",
  Casual: "casual",
  Absent: "absent",
  "On Hold": "excluded",
  "Not Hired": "excluded",
  Unknown: "unknown",
};

// Absence days counted by type. Planned leave is not an absence.
import type { DayFacts } from "./facts.js";

export const absenceTypes = [
  "NCNS",
  "AWOL",
  "Sick",
  "Casual",
  "Unpaid",
] as const;

export function absenceCounts(days: DayFacts[]) {
  const count = (test: (day: DayFacts) => boolean) => days.filter(test).length;
  return {
    NCNS: count((day) => day.absence === "NCNS"),
    AWOL: count((day) => day.absence === "AWOL"),
    Sick: count((day) => day.status === "Sick"),
    Casual: count((day) => day.status === "Casual"),
    Unpaid: count((day) => day.status.includes("UPL")),
  };
}

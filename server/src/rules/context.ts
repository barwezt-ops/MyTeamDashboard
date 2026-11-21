import type {
  Agent,
  AttendanceDay,
  Discrepancy,
  RuleId,
  ScheduleDay,
  Status,
} from "../api/dto.js";
import { excluded } from "../parse/status.js";
export interface RuleContext {
  agents: Agent[];
  schedule: ScheduleDay[];
  attendance: AttendanceDay[];
  scheduleMembers: Set<string> | null;
  today: string;
  from: string;
  attendanceEnabled: boolean;
}
export type Finding = Pick<
  Discrepancy,
  "id" | "code" | "date" | "ruleId" | "severity" | "missing" | "source"
>;
export const dayKey = (code: string, date: string) => code + "|" + date;
export function sourceIndex<T extends ScheduleDay | AttendanceDay>(rows: T[]) {
  return new Map(rows.map((row) => [dayKey(row.code, row.date), row]));
}
export const leave = new Set<Status>(["Sick", "Casual", "UPL", "PTO"]);
export const absence = new Set<Status>([...leave, "Absent"]);
export function finding(
  code: string,
  date: string,
  ruleId: RuleId,
  missing: string,
  source: Finding["source"],
  severity: Finding["severity"] = "action",
): Finding {
  return {
    id: dayKey(code, date) + "|" + ruleId,
    code,
    date,
    ruleId,
    missing,
    source,
    severity,
  };
}
export function dateAllowed(ctx: RuleContext, date: string) {
  return date >= ctx.from && date <= ctx.today;
}
export function skip(schedule?: ScheduleDay, attendance?: AttendanceDay) {
  return excluded(schedule?.status) || excluded(attendance?.status);
}

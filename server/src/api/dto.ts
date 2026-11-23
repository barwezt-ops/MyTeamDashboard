export const statuses = [
  "Scheduled",
  "Off Day",
  "PTO",
  "UPL",
  "Sick",
  "Casual",
  "Present",
  "Absent",
  "On Hold",
  "Not Hired",
  "Unknown",
] as const;
export type Status = (typeof statuses)[number];
export type Code = string;
export type Scope = "mine" | "covered" | "all";
export type RuleId = "D1" | "D2" | "D3" | "D4" | "D5" | "D6" | "D7";
export type Job = "roster" | "daily" | "all";
export interface Agent {
  code: Code;
  firstName: string;
  fullName: string;
  account: string;
  account2: string;
  dtl: string;
  tl: string;
  stl: string;
  title: string;
  hireDate: string | null;
  lastWorkingDay: string | null;
  ownerGroup: "mine" | "covered";
  active: boolean;
}
export interface ScheduleDay {
  code: Code;
  date: string;
  raw: string;
  status: Status;
  shiftStart: string | null;
}
export interface AttendanceDay {
  code: Code;
  date: string;
  raw: string;
  status: Status;
  missing: string | null;
}
export interface Discrepancy {
  id: string;
  code: Code;
  date: string;
  ruleId: RuleId;
  severity: "action" | "info";
  missing: string;
  source: "schedule" | "attendance" | "roster";
  state: "open" | "ack" | "resolved";
  tlComment: string;
  createdAt: string;
  updatedAt: string;
}
export interface DiscrepancyRow extends Discrepancy {
  firstName: string;
  tl: string;
  account: string;
}
export interface NoteInput {
  date: string;
  whatHappened: string;
  whatWasSaid: string;
  nextStep: string;
  followUpDate: string | null;
  done: boolean;
}
export interface Note extends NoteInput {
  id: number;
  code: Code;
  createdAt: string;
}
export interface TodayData {
  date: string;
  attendanceEnabled: boolean;
  counts: Record<
    | "scheduled"
    | "present"
    | "off"
    | "leave"
    | "unplanned"
    | "excluded"
    | "unknown"
    | "notOnSchedule",
    number
  >;
  agents: {
    agent: Omit<Agent, "fullName">;
    schedule: ScheduleDay | null;
    attendance: AttendanceDay | null;
  }[];
  coverage: { shiftStart: string; count: number }[];
  openActions: DiscrepancyRow[];
  confirmReturn: DiscrepancyRow[];
  followUpsDue: Note[];
}
export interface AgentProfile {
  agent: Agent;
  next7: ScheduleDay[];
  history: {
    date: string;
    schedule: ScheduleDay | null;
    attendance: AttendanceDay | null;
  }[];
  discrepancies: DiscrepancyRow[];
  notes: Note[];
  fixedOffDays: string[];
}
export interface RosterEvent {
  id: number;
  date: string;
  code: Code;
  type: "new" | "left" | "moved" | "rejoined";
  detail: string;
  firstName: string;
}
export interface SyncRun {
  id: number;
  job: string;
  startedAt: string;
  finishedAt: string | null;
  ok: boolean | null;
  rowsRead: number | null;
  rowsKept: number | null;
  warnings: string[];
  error: string | null;
}
export interface SyncStatus {
  jobs: Record<
    string,
    { lastRun: SyncRun | null; lastSuccessAt: string | null }
  >;
  sources: {
    label: string;
    url: string | null;
    job: string;
    enabled: boolean;
  }[];
  runs: SyncRun[];
  running: Job | null;
  timezone: string;
  config: unknown;
  date: string;
  window: { from: string; to: string };
}
export const trendStatuses = [
  "Sick",
  "Casual",
  "UPL",
  "PTO",
  "Absent",
  "Off Day",
] as const;
export type TrendStatus = (typeof trendStatuses)[number];
export interface TrendsData {
  agents: {
    code: Code;
    firstName: string;
    counts: Record<TrendStatus, number>;
    discrepancies: number;
    badges: { status: Status; count: number; days: number }[];
  }[];
  totals: Record<TrendStatus, number>;
  daily: ({ date: string } & Record<Status, number>)[];
}

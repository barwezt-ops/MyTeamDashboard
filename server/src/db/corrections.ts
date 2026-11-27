import type { AttendanceDay, Status } from "../api/dto.js";
import type { Db } from "./db.js";
import { labelOf } from "../parse/normalize.js";

export type Correction = {
  source: "sheet" | "app";
  note: string;
  label: string | null;
  status: Status | null;
  wfmRaw: string;
  wfmStatus: Status;
  wfmMissing: string | null;
  state: "corrected" | "explained" | "updated";
};
export type CorrectionListRow = Correction & {
  code: string;
  name: string;
  date: string;
  used: string;
  display: string;
};
type StoredCorrection = Pick<
  Correction,
  "source" | "note" | "label" | "status"
> & { code: string; date: string };
export const statusLabel = (label: string) =>
  label.replace(/\b[a-z]+\b/g, (word) =>
    ["upl", "ncns", "awol", "pto"].includes(word)
      ? word.toUpperCase()
      : word[0].toUpperCase() + word.slice(1),
  );

export function correctionsOf(db: Db) {
  // The preview CLI can read an older installed database without migrating it.
  if (
    !db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='attendance_corrections'",
      )
      .get()
  )
    return new Map<string, StoredCorrection>();
  const rows = db
    .prepare(
      `
    SELECT code,date,note,label,status,'sheet' AS source FROM attendance_sheet_comments s
    WHERE (label IS NOT NULL OR explained=1) AND NOT EXISTS (
      SELECT 1 FROM attendance_corrections a WHERE a.code=s.code AND a.date=s.date
    )
    UNION ALL
    SELECT code,date,note,label,status,'app' AS source FROM attendance_corrections
  `,
    )
    .all() as StoredCorrection[];
  // Sheet rows are excluded when an owner correction exists.
  return new Map(rows.map((row) => [row.code + "|" + row.date, row]));
}

export function correctedDay(
  row: AttendanceDay,
  correction:
    | Omit<Correction, "wfmRaw" | "wfmStatus" | "wfmMissing" | "state">
    | undefined,
): AttendanceDay {
  if (!correction) return row;
  const updated =
    !!correction.label && labelOf(row.raw) === labelOf(correction.label);
  const active = !!correction.label && !updated;
  return {
    ...row,
    ...(active
      ? {
          raw: statusLabel(correction.label!),
          status: correction.status!,
          missing: workStatus(correction.status!) ? row.missing : null,
        }
      : {}),
    correction: {
      ...correction,
      wfmRaw: row.raw,
      wfmStatus: row.status,
      wfmMissing: row.missing,
      state: updated ? "updated" : active ? "corrected" : "explained",
    },
  };
}

export const workStatus = (status: Status) =>
  status === "Present" || status === "Scheduled" || status.includes("Half");

/** Safe for reports/CSV: provenance, without private comment or note text. */
export function attendanceLabel(row: {
  raw: string;
  status: Status;
  correction?: Correction;
}) {
  const correction = row.correction;
  if (!correction) return row.raw || row.status;
  if (correction.state === "updated") return `${row.raw} · WFM updated`;
  if (correction.state === "explained")
    return `${row.raw || row.status} · Explained`;
  return `${correction.wfmRaw || correction.wfmStatus} → ${row.raw} · ${correction.source === "sheet" ? "TL comment" : "App correction"}`;
}

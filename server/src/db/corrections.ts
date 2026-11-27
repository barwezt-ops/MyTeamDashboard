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
  state: "corrected" | "explained" | "updated" | "waived";
  waivers?: { late: boolean; missing: boolean };
  warning?: string;
};
export type CorrectionListRow = Correction & {
  code: string;
  name: string;
  date: string;
  used: string;
  display: string;
  waiverDisplay?: string[];
};
type StoredCorrection = Pick<
  Correction,
  "source" | "note" | "label" | "status"
> & { code: string; date: string; warning?: string };
export const statusLabel = (label: string) =>
  label.replace(/\b[a-z]+\b/g, (word) =>
    ["upl", "ncns", "awol", "pto"].includes(word)
      ? word.toUpperCase()
      : word[0].toUpperCase() + word.slice(1),
  );

export function commentWaivers(note: string) {
  const waive = /waive/i.test(note);
  return {
    late: waive && /\b(?:late|lateness)\b/i.test(note),
    missing: waive && /\bmissing\b/i.test(note),
  };
}

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
    SELECT code,date,note,label,status,'sheet' AS source,
      CASE WHEN explained=2 THEN 'names more than one status, not corrected' ELSE '' END AS warning
    FROM attendance_sheet_comments s
    WHERE (label IS NOT NULL OR explained>0) AND NOT EXISTS (
      SELECT 1 FROM attendance_corrections a WHERE a.code=s.code AND a.date=s.date
    )
    UNION ALL
    SELECT code,date,note,label,status,'app' AS source,'' AS warning FROM attendance_corrections
  `,
    )
    .all() as StoredCorrection[];
  if (!rows.length) return new Map<string, StoredCorrection>();
  // Sheet rows are excluded when an owner correction exists.
  const waivers = new Map(
    (
      db
        .prepare("SELECT code,date,note FROM attendance_sheet_comments")
        .all() as { code: string; date: string; note: string }[]
    ).map((row) => [row.code + "|" + row.date, commentWaivers(row.note)]),
  );
  return new Map(
    rows.map((row) => {
      const key = row.code + "|" + row.date;
      const waiver = waivers.get(key);
      return [
        key,
        {
          ...row,
          ...(waiver?.late || waiver?.missing ? { waivers: waiver } : {}),
        },
      ];
    }),
  );
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
    ...(correction.waivers?.missing ? { missing: null } : {}),
    correction: {
      ...correction,
      wfmRaw: row.raw,
      wfmStatus: row.status,
      wfmMissing: row.missing,
      state: updated
        ? "updated"
        : active
          ? "corrected"
          : correction.waivers && !correction.warning
            ? "waived"
            : "explained",
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
  if (correction.state === "waived")
    return `${row.raw || row.status} · TL waiver`;
  return `${correction.wfmRaw || correction.wfmStatus} → ${row.raw} · ${correction.source === "sheet" ? "TL comment" : "App correction"}`;
}

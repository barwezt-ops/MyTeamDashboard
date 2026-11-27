// The status map is read-only here. This lists the labels seen in the owner's
// team data that it does not cover, so they can be added to the config file.
import type { Config } from "../config.js";
import type { Db } from "../db/db.js";
import { labelOf } from "../parse/normalize.js";
import { parseStatus } from "../parse/status.js";

export type UnmappedStatus = {
  label: string;
  source: "Attendance" | "Schedule" | "MTD";
  /** Agent days seen, or agents for MTD. */
  count: number;
  last: string;
};

type Seen = { raw: string; count: number; last: string };

export function statusMapView(db: Db, config: Config) {
  const seen = (sql: string) => db.prepare(sql).all() as Seen[];
  const days = (table: "attendance_days" | "schedule_days") =>
    seen(
      `SELECT d.raw AS raw, COUNT(*) AS count, MAX(d.date) AS last FROM ${table} d JOIN agents a ON a.code=d.code WHERE a.owner_group='mine' GROUP BY d.raw`,
    );
  const mtd = seen(
    "SELECT json_extract(d.fields,'$.status') AS raw, COUNT(DISTINCT d.code) AS count, MAX(d.sync_date) AS last FROM attendance_mtd_snapshots d JOIN agents a ON a.code=d.code WHERE a.owner_group='mine' GROUP BY raw",
  );
  const sources = [
    ["Attendance", days("attendance_days")],
    ["Schedule", days("schedule_days")],
    // "Active" is MTD's own label and needs no mapping.
    ["MTD", mtd.filter((row) => labelOf(row.raw ?? "") !== "active")],
  ] as const;
  const unmapped: UnmappedStatus[] = sources.flatMap(([source, rows]) => {
    // Labels that differ only in case or spacing are one label.
    const grouped = new Map<string, UnmappedStatus>();
    for (const { raw, count, last } of rows) {
      const key = labelOf(raw ?? "");
      if (!key || parseStatus(raw, config.statusMap).status !== "Unknown")
        continue;
      const found = grouped.get(key);
      grouped.set(key, {
        label: found?.label ?? raw.trim(),
        source,
        count: count + (found?.count ?? 0),
        last: found && found.last > last ? found.last : last,
      });
    }
    return [...grouped.values()];
  });
  return {
    entries: Object.entries(config.statusMap),
    unmapped: unmapped.sort(
      (a, b) => b.last.localeCompare(a.last) || a.label.localeCompare(b.label),
    ),
  };
}
export type StatusMapView = ReturnType<typeof statusMapView>;

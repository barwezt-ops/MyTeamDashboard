import type { Config, SourceKey } from "../config.js";
import { indexOf } from "../parse/columns.js";
import { localDate, parseDate, plusDays } from "../parse/normalize.js";

export function sampleSourceDate(
  rows: string[][],
  config: Config,
  source?: SourceKey,
  now = new Date(),
): string | null {
  const { master, schedule, attendance } = config.sources;
  const { dateOrder } = config;
  if (source === "schedule") return schedule.anchor.date;

  const today = localDate(config.timezone, now);
  const window = {
    from: plusDays(today, -config.syncWindow.pastDays),
    to: plusDays(today, config.syncWindow.futureDays),
  };
  if (source === "attendance" && attendance.layout === "wide") {
    const header = rows[attendance.wide.dateHeaderRow - 1] ?? [];
    for (const cell of header.slice(indexOf(attendance.wide.firstDateColumn))) {
      const date = parseDate(cell, { dateOrder, window, ignoreYear: true });
      if (date) return date;
    }
    return null;
  }

  const columns =
    source === "master"
      ? [master.columns.hireDate, master.columns.lastWorkingDay].map(indexOf)
      : source === "attendance"
        ? [indexOf(attendance.long.columns.date)]
        : null;
  const firstRow = source ? config.sources[source].headerRows : 0;
  for (let i = firstRow; i < rows.length; i++) {
    const cells = columns ? columns.map((column) => rows[i][column]) : rows[i];
    for (const cell of cells) {
      const date = parseDate(cell ?? "", { dateOrder, window });
      if (date) return date;
    }
  }
  return null;
}

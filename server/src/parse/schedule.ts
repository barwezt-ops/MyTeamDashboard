import type { ScheduleDay } from "../api/dto.js";
import type { Config } from "../config.js";
import { checkColumns, indexOf } from "./columns.js";
import { codeOf, plusDays, weekday, weekdays } from "./normalize.js";
import { parseStatus } from "./status.js";
export interface Window {
  from: string;
  to: string;
}
export function parseSchedule(
  rows: string[][],
  config: Config,
  codes: Set<string>,
  window: Window,
) {
  const { columns, headerRows, anchor, stopAtHeader } = config.sources.schedule;
  const warnings = checkColumns(rows, { code: columns.code }, headerRows);
  const header = rows[headerRows - 1] ?? [];
  const anchorIndex = indexOf(anchor.column);
  const stop = new RegExp(stopAtHeader, "i");
  const end = header.findIndex(
    (value, index) => index >= anchorIndex && stop.test(value),
  );
  if (end < anchorIndex) throw new Error("MISSING_SCHEDULE_STOP_HEADER");
  if (end === anchorIndex)
    throw new Error("MISSING_REQUIRED_COLUMN:schedule dates");
  const dates = Array.from({ length: end - anchorIndex }, (_, offset) =>
    plusDays(anchor.date, offset),
  );
  let mismatches = 0;
  for (
    let index = anchorIndex;
    index < Math.min(end, indexOf("AA") + 1);
    index++
  ) {
    const actual = weekdays.findIndex((day) =>
      header[index]
        ?.trim()
        .toLowerCase()
        .startsWith(day.slice(0, 3).toLowerCase()),
    );
    if (actual !== weekday(dates[index - anchorIndex])) mismatches++;
  }
  if (mismatches > 2) warnings.push("ANCHOR_MISMATCH");
  const records: ScheduleDay[] = [];
  const scheduledCodes = new Set<string>();
  const keepDates = dates
    .map((date, offset) => ({ date, index: anchorIndex + offset }))
    .filter(({ date }) => date >= window.from && date <= window.to);
  for (const row of rows.slice(headerRows)) {
    const code = codeOf(row[indexOf(columns.code)]);
    if (!codes.has(code) || scheduledCodes.has(code)) continue;
    scheduledCodes.add(code);
    for (const { date, index } of keepDates) {
      const raw = row[index]?.trim() ?? "";
      records.push({ code, date, raw, ...parseStatus(raw, config.statusMap) });
    }
  }
  return { records, warnings, scheduledCodes, dates };
}

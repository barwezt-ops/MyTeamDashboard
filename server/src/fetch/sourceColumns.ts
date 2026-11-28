import type { Config, SourceKey } from "../config.js";
import { indexOf } from "../parse/columns.js";
import { sensitiveHeader } from "../parse/master.js";
import { SourceAccessError } from "./fetchCsv.js";

export function sourceMapping(config: Config, source: SourceKey) {
  const { master, schedule, attendance } = config.sources;
  if (source === "master")
    return { fields: master.columns, headerRows: master.headerRows };
  if (source === "schedule")
    return {
      fields: { ...schedule.columns, firstDate: schedule.anchor.column },
      headerRows: schedule.headerRows,
    };
  if (attendance.layout === "wide")
    return {
      fields: {
        key: attendance.wide.keyColumn,
        dtl: attendance.wide.dtlColumn,
        firstDate: attendance.wide.firstDateColumn,
      },
      headerRows: attendance.wide.dateHeaderRow,
    };
  return { fields: attendance.long.columns, headerRows: attendance.headerRows };
}

export function sourceColumnIndices(config: Config, source: SourceKey) {
  const columns = new Set(
    Object.values(sourceMapping(config, source).fields)
      .filter((letter): letter is string => !!letter)
      .map(indexOf),
  );
  const { schedule, attendance } = config.sources;
  const span =
    source === "schedule" && schedule.stopColumn
      ? [schedule.anchor.column, schedule.stopColumn]
      : source === "attendance" &&
          attendance.layout === "wide" &&
          attendance.wide.lastDateColumn
        ? [attendance.wide.firstDateColumn, attendance.wide.lastDateColumn]
        : [];
  if (span.length)
    for (let i = indexOf(span[0]); i <= indexOf(span[1]); i++) columns.add(i);
  return [...columns].sort((a, b) => a - b);
}

export const patientHeader = (value: string) =>
  /patient|medical\W*record|\bmrn\b|diagnos(?:is|es)|\bicd\b|clinical\W*(?:notes?|records?)|date\W*of\W*birth|\bdob\b/i.test(
    value.replaceAll("_", " "),
  );

export const patientOrCallerHeader = (value: string) => {
  const header = value.replaceAll("_", " ");
  return (
    patientHeader(header) ||
    /caller|call\W*(?:id\b|detail|record)|recording/i.test(header)
  );
};

export const privateHeader = (value: string) =>
  sensitiveHeader(value) || patientHeader(value);

export const refusedHeader = (value: string) =>
  patientOrCallerHeader(value) || privateHeader(value);

// Owner-approved exception is confined to the Attendance paste reader.
export const pastePrivateHeader = (value: string) =>
  value.trim().toLowerCase() !== "tl comment" && privateHeader(value);

export function checkSourceHeaders(
  rows: string[][],
  config: Config,
  source: SourceKey,
  mapped: boolean,
  diagnostic = false,
) {
  const { fields, headerRows } = sourceMapping(config, source);
  const header = rows[headerRows - 1] ?? [];
  const lastHeader = Math.max(headerRows, config.sources[source].headerRows);
  if (rows.slice(0, lastHeader).some((row) => row.some(patientHeader)))
    throw new SourceAccessError(
      "Possible patient data in the source headers. Stop and review the source.",
    );
  const columns = mapped
    ? sourceColumnIndices(config, source)
    : Object.values(fields)
        .filter((letter): letter is string => !!letter)
        .map(indexOf);
  if (
    !diagnostic &&
    columns.some((index) => privateHeader(header[index] ?? ""))
  )
    throw new SourceAccessError(
      "A mapped column has a sensitive header. Review the column mapping.",
    );
}

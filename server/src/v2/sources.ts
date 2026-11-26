// The line/queue tab and the QA sheet. Both keep only whitelisted fields for
// the owner's team, joined on agent code.
import { readFileSync } from "node:fs";
import type { Config } from "../config.js";
import type { Db } from "../db/db.js";
import type { ScheduleDay } from "../api/dto.js";
import { fetchCsv, decodeCsv } from "../fetch/fetchCsv.js";
import { exportUrl } from "../fetch/urls.js";
import { patientHeader, privateHeader } from "../fetch/sourceColumns.js";
import { columnAt } from "../parse/columns.js";
import {
  codeOf,
  labelOf,
  localDate,
  parseDate,
  weekday,
  weekdays,
} from "../parse/normalize.js";
import { parseStatus } from "../parse/status.js";

/** Headers that suggest patient or caller data. The source is not mapped. */
export const patientOrCallerHeader = (value: string) => {
  const header = value.replaceAll("_", " ");
  return (
    patientHeader(header) ||
    /caller|call\W*(?:id\b|detail|record)|recording/i.test(header)
  );
};
/** Headers that may never be mapped. */
export const refusedHeader = (value: string) =>
  patientOrCallerHeader(value) || privateHeader(value);

/** Reports headers and a row count. It never returns cell values. */
export function inspectHeaders(rows: string[][], headerRows = 1) {
  const headers = rows[headerRows - 1] ?? [];
  return {
    headers: headers.flatMap((value, index) => {
      const header = value.trim();
      if (!header) return [];
      // A long, email-like or digit-heavy "header" is probably a data value.
      const safe =
        header.length <= 100 && !/@|\d(?:[\s()-]*\d){6,}/.test(header);
      return [
        {
          column: columnAt(index),
          header: safe ? header : "[excluded]",
          refused: !safe || refusedHeader(header),
        },
      ];
    }),
    rowCount: rows.slice(headerRows).filter((row) => row.some(Boolean)).length,
    stop: headers.some(patientOrCallerHeader)
      ? "Headers look like patient or caller data. Stop and review this source with the owner."
      : null,
  };
}

const teamCodes = (db: Db) =>
  new Set(
    db
      .prepare("SELECT code FROM agents WHERE owner_group='mine' AND active=1")
      .pluck()
      .all() as string[],
  );

export type QueueRecord = {
  code: string;
  line: string;
  account: string;
  /** Sunday first, matching `weekday()`. */
  template: string[];
};

export function parseQueues(
  allRows: string[][],
  codes: Set<string>,
  options: {
    headerRows?: number;
    headers?: { code: string; line: string; account: string };
  } = {},
) {
  const rows = allRows.slice((options.headerRows ?? 1) - 1);
  const header = rows[0] ?? [];
  if (
    allRows
      .slice(0, options.headerRows ?? 1)
      .some((row) => row.some(patientOrCallerHeader))
  )
    throw new Error(
      "Possible patient or caller data in queue headers. Stop and review the source.",
    );
  const column = (name: string, short?: string) => {
    const hits = header.flatMap((value, i) =>
      labelOf(value) === labelOf(name) || (short && labelOf(value) === short)
        ? [i]
        : [],
    );
    if (hits.length !== 1 || privateHeader(header[hits[0]]))
      throw new Error("Queue template requires one " + name + " column");
    return hits[0];
  };
  const names = options.headers ?? {
    code: "Code",
    line: "Line",
    account: "Account",
  };
  const code = column(names.code),
    line = column(names.line),
    account = column(names.account);
  const days = weekdays.map((day) =>
    column(day, day.slice(0, 3).toLowerCase()),
  );
  const seen = new Set<string>();
  let blankLines = 0;
  const records = rows.slice(1).flatMap((row): QueueRecord[] => {
    const id = codeOf(row[code]);
    if (!codes.has(id)) return [];
    if (seen.has(id)) throw new Error("Duplicate team code in queue template");
    seen.add(id);
    if (!row[line]?.trim()) {
      blankLines++;
      return [];
    }
    return [
      {
        code: id,
        line: row[line].trim(),
        account: row[account]?.trim() ?? "",
        template: days.map((i) => row[i]?.trim() ?? ""),
      },
    ];
  });
  if (!records.length) throw new Error("NO_TEAM_ROWS");
  const warnings = [];
  if (blankLines) warnings.push("QUEUE_LINE_BLANK:" + blankLines);
  const absent = [...codes].filter((id) => !seen.has(id)).length;
  if (absent) warnings.push("QUEUE_AGENTS_MISSING:" + absent);
  return { records, warnings };
}

/** Adds a history row only when an agent's line, account or template changes. */
export function storeQueues(
  db: Db,
  records: QueueRecord[],
  at: Date,
  zone: string,
) {
  db.transaction(() => {
    const prior = db.prepare(
      "SELECT line,account,template FROM line_history WHERE code=? ORDER BY id DESC LIMIT 1",
    );
    const insert = db.prepare(
      "INSERT INTO line_history(code,changed_at,changed_on,line,account,template) VALUES (?,?,?,?,?,?)",
    );
    for (const record of records) {
      const row = prior.get(record.code) as
        { line: string; account: string; template: string } | undefined;
      const template = JSON.stringify(record.template);
      if (
        !row ||
        row.line !== record.line ||
        row.account !== record.account ||
        row.template !== template
      )
        insert.run(
          record.code,
          at.toISOString(),
          localDate(zone, at),
          record.line,
          record.account,
          template,
        );
    }
  })();
}

const csvRows = async (
  mode: "live" | "fixture",
  fixture: string,
  source: { sheetId: string; gid: string },
) =>
  mode === "fixture"
    ? decodeCsv(readFileSync("fixtures/" + fixture + ".sample.csv", "utf8"))
    : (await fetchCsv(exportUrl(source.sheetId, source.gid))).rows;

export async function syncQueues(
  db: Db,
  config: Config,
  mode: "live" | "fixture",
  at: Date,
) {
  const source = config.sources.lineQueue;
  if (!source?.enabled) return { rowsRead: 0, rowsKept: 0, warnings: [] };
  const rows = await csvRows(mode, "line-queue", source);
  const { records, warnings } = parseQueues(rows, teamCodes(db), source);
  storeQueues(db, records, at, config.timezone);
  return { rowsRead: rows.length, rowsKept: records.length, warnings };
}

export type LineHistory = {
  id: number;
  code: string;
  changed_at: string;
  changed_on: string;
  line: string;
  account: string;
  template: string;
};

export type PlannedDay = ScheduleDay & { source: "dated" | "template" };

/**
 * The dated schedule wins. The weekly template from the line history is used
 * only when the dated schedule has no entry, meaning no row or a blank cell.
 * `lines` is this agent's history, oldest first.
 */
export function plannedDay(
  code: string,
  date: string,
  dated: ScheduleDay[],
  lines: LineHistory[],
  config: Config,
): PlannedDay | null {
  const actual = dated.find((row) => row.code === code && row.date === date);
  if (actual?.raw) return { ...actual, source: "dated" };
  const line = lines
    .filter((row) => row.code === code && row.changed_on <= date)
    .at(-1);
  const raw = line
    ? String((JSON.parse(line.template) as string[])[weekday(date)] ?? "")
    : "";
  if (raw)
    return {
      code,
      date,
      raw,
      ...parseStatus(raw, config.statusMap),
      source: "template",
    };
  return actual ? { ...actual, source: "dated" } : null;
}

export function parseQa(
  rawRows: string[][],
  config: Config,
  codes: Set<string>,
) {
  const source = config.sources.qa;
  const rows = rawRows.slice((source?.headerRows ?? 1) - 1);
  if (inspectHeaders(rows).stop)
    throw new Error(
      "Possible patient or caller data in QA headers. Stop and review the source.",
    );
  if (!source?.mappingApproved || !source.columns)
    throw new Error("QA mapping needs owner approval");
  const columns = new Map<string, number>();
  for (const [field, header] of Object.entries(source.columns)) {
    const hits = rows[0].flatMap((value, i) =>
      labelOf(value) === labelOf(header) ? [i] : [],
    );
    if (hits.length !== 1 || refusedHeader(header))
      throw new Error("Approved QA header is missing or refused");
    columns.set(field, hits[0]);
  }
  const mapped = rows.slice(1).flatMap((row) => {
    const code = codeOf(row[columns.get("code")!]);
    if (!codes.has(code)) return [];
    const date = parseDate(row[columns.get("date")!] ?? "", {
      dateOrder: config.dateOrder,
    });
    const raw = row[columns.get("score")!]?.trim().replace(/%$/, "").trim();
    if (!date || !/^\d+(?:\.\d+)?$/.test(raw ?? ""))
      throw new Error("Invalid date or percentage in approved QA fields");
    const score = Number(raw);
    if (score > 100) throw new Error("QA percentage must be between 0 and 100");
    const form = columns.has("form")
      ? (row[columns.get("form")!]?.trim() ?? "")
      : "";
    if (form.length > 100) throw new Error("QA form name is too long");
    return [{ code, date, score, form }];
  });
  if (!mapped.length) throw new Error("NO_TEAM_ROWS");
  return mapped;
}

/** Replaces only the agent and date pairs present in this read. */
export async function syncQa(db: Db, config: Config, mode: "live" | "fixture") {
  const source = config.sources.qa;
  if (!source?.enabled || !source.mappingApproved)
    return { rowsRead: 0, rowsKept: 0, warnings: [] };
  const rows = await csvRows(mode, "qa", source);
  const records = parseQa(rows, config, teamCodes(db));
  db.transaction(() => {
    const remove = db.prepare(
      "DELETE FROM qa_evaluations WHERE code=? AND date=?",
    );
    for (const record of records) remove.run(record.code, record.date);
    const insert = db.prepare(
      "INSERT INTO qa_evaluations(code,date,score,form) VALUES (@code,@date,@score,@form)",
    );
    for (const record of records) insert.run(record);
  })();
  return { rowsRead: rows.length, rowsKept: records.length, warnings: [] };
}

// The line/queue tab and the QA sheet. Both keep only whitelisted fields for
// the owner's team, joined on agent code.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Config } from "../config.js";
import type { Db } from "../db/db.js";
import type { ScheduleDay } from "../api/dto.js";
import { fetchCsv, decodeCsv } from "../fetch/fetchCsv.js";
import { fetchGoogleMappedTabRows } from "../fetch/googleSheets.js";
import { exportUrl } from "../fetch/urls.js";
import {
  patientOrCallerHeader,
  privateHeader,
  refusedHeader,
} from "../fetch/sourceColumns.js";
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

export { patientOrCallerHeader, refusedHeader };

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

const qaCodes = (db: Db) =>
  new Set(
    db
      .prepare("SELECT code FROM agents WHERE owner_group='mine'")
      .pluck()
      .all() as string[],
  );

type Cell = string | number | boolean;
export type QaRecord = {
  code: string;
  date: string;
  score: number;
  form: string;
  autofail: boolean;
  account: string;
};

const dayMs = 86_400_000;
const serialEpoch = Date.UTC(1899, 11, 30);

function qaDate(value: Cell | undefined, dateOrder: Config["dateOrder"]) {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 1 || value > 2_958_465) return null;
    return new Date(serialEpoch + Math.floor(value) * dayMs)
      .toISOString()
      .slice(0, 10);
  }
  const text = String(value ?? "").trim();
  if (/^\d+(?:\.\d+)?$/.test(text)) {
    const serial = Number(text);
    if (Number.isFinite(serial) && serial >= 1 && serial <= 2_958_465)
      return new Date(serialEpoch + Math.floor(serial) * dayMs)
        .toISOString()
        .slice(0, 10);
  }
  return parseDate(text, { dateOrder });
}

function qaScore(value: Cell | undefined, fraction: boolean): number | null {
  const rawText =
    typeof value === "string" ? value.trim() : String(value ?? "").trim();
  if (!rawText) return null;
  const hasPercent = rawText.endsWith("%");
  const clean = hasPercent ? rawText.slice(0, -1).trim() : rawText;
  if (!/^-?\d+(?:\.\d+)?$/.test(clean)) return null;
  const num = Number(clean);
  if (!Number.isFinite(num)) return null;
  const score =
    !hasPercent && fraction ? Number((num * 100).toPrecision(12)) : num;
  return score;
}

export function parseQaReport(
  rawRows: Cell[][],
  config: Config,
  codes: Set<string>,
) {
  const source = config.sources.qa;
  const rows = rawRows.slice((source?.headerRows ?? 1) - 1);
  if (
    inspectHeaders(
      rows.map((row) => row.map((cell) => String(cell ?? ""))),
      1,
    ).stop
  )
    throw new Error(
      "Possible patient or caller data in QA headers. Stop and review the source.",
    );
  if (!source?.mappingApproved || !source.columns)
    throw new Error("QA mapping needs owner approval");
  const header = rows[0] ?? [];
  const columns = new Map<string, number>();
  for (const [field, name] of Object.entries(source.columns)) {
    if (!name) continue;
    const hits = header.flatMap((value, i) =>
      labelOf(String(value ?? "")) === labelOf(name) ? [i] : [],
    );
    if (
      hits.length !== 1 ||
      refusedHeader(name) ||
      refusedHeader(String(header[hits[0]] ?? ""))
    )
      throw new Error("Approved QA header is missing or refused");
    columns.set(field, hits[0]);
  }
  const dataRows = rows
    .slice(1)
    .filter((row) => row.some((cell) => String(cell ?? "").trim() !== ""));
  if (!dataRows.length) throw new Error("QA tab has 0 data rows");
  const fraction =
    source.scoreFormat === "fraction" ||
    (source.scoreFormat === undefined && source.access === "google");
  let skippedUnknown = 0;
  const records: QaRecord[] = [];
  for (const row of dataRows) {
    const code = codeOf(String(row[columns.get("code")!] ?? ""));
    if (!code || !codes.has(code)) {
      skippedUnknown++;
      continue;
    }
    const date = qaDate(row[columns.get("date")!], config.dateOrder);
    const score = qaScore(row[columns.get("score")!], fraction);
    if (!date || score === null)
      throw new Error("Invalid date or percentage in approved QA fields");
    if (score < 0 || score > 100)
      throw new Error("QA percentage must be between 0 and 100");
    const autofailRaw = columns.has("autofail")
      ? String(row[columns.get("autofail")!] ?? "").trim()
      : "";
    const autofail = autofailRaw !== "";
    const formRaw = columns.has("form")
      ? String(row[columns.get("form")!] ?? "").trim()
      : "";
    const form = formRaw || autofailRaw;
    if (form.length > 100) throw new Error("QA form name is too long");
    const account = columns.has("account")
      ? String(row[columns.get("account")!] ?? "").trim()
      : "";
    if (account.length > 100) throw new Error("QA account label is too long");
    records.push({ code, date, score, form, autofail, account });
  }
  const warnings = skippedUnknown
    ? [
        `Skipped ${skippedUnknown} QA ${skippedUnknown === 1 ? "row" : "rows"} with unknown agent code`,
      ]
    : [];
  return {
    records,
    rowsRead: dataRows.length,
    skippedUnknown,
    warnings,
  };
}

export function parseQa(rawRows: Cell[][], config: Config, codes: Set<string>) {
  return parseQaReport(rawRows, config, codes).records;
}

/** Replaces the full QA snapshot in one transaction with safety guards. */
export async function syncQa(
  db: Db,
  config: Config,
  mode: "live" | "fixture",
  now = new Date(),
  dataDir = ":memory:",
  request = fetch,
) {
  const source = config.sources.qa;
  if (!source?.enabled || !source.mappingApproved || !source.columns)
    return { rowsRead: 0, rowsKept: 0, warnings: [] };
  const rows: Cell[][] =
    mode === "fixture"
      ? decodeCsv(readFileSync("fixtures/qa.sample.csv", "utf8"))
      : source.access === "google"
        ? await fetchGoogleMappedTabRows(
            source.sheetId,
            source.gid,
            source.headerRows || 1,
            Object.values(source.columns).filter(
              (value): value is string => !!value,
            ),
            dataDir,
            request,
          )
        : (await fetchCsv(exportUrl(source.sheetId, source.gid))).rows;
  const report = parseQaReport(rows, config, qaCodes(db));
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        rowsRead: report.rowsRead,
        skippedUnknown: report.skippedUnknown,
        records: report.records,
      }),
    )
    .digest("hex");
  const changed = db.transaction(() => {
    const state = db
      .prepare("SELECT fingerprint, row_count FROM qa_state WHERE id=1")
      .get() as { fingerprint: string; row_count: number } | undefined;
    const prevCount =
      state?.row_count ??
      (db
        .prepare(
          "SELECT rows_read FROM sync_log WHERE job='qa' AND ok=1 ORDER BY id DESC LIMIT 1",
        )
        .pluck()
        .get() as number | undefined) ??
      0;
    if (prevCount && report.rowsRead * 2 < prevCount)
      throw new Error("QA tab looks incomplete");
    const isChanged = state?.fingerprint !== fingerprint;
    if (isChanged) {
      db.prepare("DELETE FROM qa_evaluations").run();
      const insert = db.prepare(
        "INSERT INTO qa_evaluations(code,date,score,form,autofail,account) VALUES (@code,@date,@score,@form,@autofail,@account)",
      );
      for (const record of report.records)
        insert.run({ ...record, autofail: Number(record.autofail) });
      db.prepare(
        "INSERT INTO qa_state (id,fingerprint,last_changed_at,row_count) VALUES (1,?,?,?) ON CONFLICT(id) DO UPDATE SET fingerprint=excluded.fingerprint,last_changed_at=excluded.last_changed_at,row_count=excluded.row_count",
      ).run(fingerprint, now.toISOString(), report.rowsRead);
    }
    return isChanged;
  })();
  return {
    rowsRead: report.rowsRead,
    rowsKept: report.records.length,
    warnings: [...report.warnings, ...(changed ? [] : ["no change"])],
  };
}

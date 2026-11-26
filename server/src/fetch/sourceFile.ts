import { randomUUID } from "node:crypto";
import {
  createReadStream,
  lstatSync,
  mkdirSync,
  readdirSync,
  renameSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { parse } from "csv-parse";
import type { Agent } from "../api/dto.js";
import type { Config, SourceKey } from "../config.js";
import { attendanceTeam } from "../parse/attendance.js";
import { indexOf } from "../parse/columns.js";
import { codeOf, nameOf, parseDate } from "../parse/normalize.js";
import { SourceAccessError } from "./fetchCsv.js";
import {
  checkSourceHeaders,
  privateHeader,
  sourceColumnIndices,
} from "./sourceColumns.js";

export const csvLimit = 150 * 1024 * 1024;

function inbox(source: SourceKey, dataDir: string) {
  if (process.env.LOCALAPPDATA)
    return join(process.env.LOCALAPPDATA, "TeamDashboard", "inbox", source);
  if (dataDir === ":memory:")
    throw new SourceAccessError("File sources require persistent storage.");
  return join(dataDir, "inbox", source);
}

function csvNames(folder: string) {
  try {
    return readdirSync(folder, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.csv$/i.test(entry.name))
      .map((entry) => entry.name);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function readAttendanceCsv(
  input: AsyncIterable<Buffer>,
  config: Config,
  agents: Agent[],
) {
  const settings = config.sources.attendance;
  const wide = settings.layout === "wide" ? settings.wide : undefined;
  const key = indexOf(wide?.keyColumn ?? settings.long.columns.code);
  const headerCount = Math.max(settings.headerRows, wide?.dateHeaderRow ?? 0);
  const { codes, names } = attendanceTeam(agents);
  const columns = sourceColumnIndices(config, "attendance");
  const rows: string[][] = [];
  let bytes = 0;
  let rowsRead = 0;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const stream = Readable.from(
    (async function* () {
      for await (const chunk of input) {
        bytes += chunk.length;
        if (bytes > csvLimit)
          throw new SourceAccessError(
            "The attendance CSV exceeds 150 MB.",
            413,
          );
        const text = decoder.decode(chunk, { stream: true });
        if (text.includes("\0")) throw new Error("Invalid CSV encoding");
        yield text;
      }
      yield decoder.decode();
    })(),
  );
  const parser = parse({
    bom: true,
    relax_column_count: true,
    max_record_size: csvLimit,
  });
  stream.on("error", (error) => parser.destroy(error));
  stream.pipe(parser);
  const project = (record: string[]) => {
    const kept: string[] = Array.from(
      { length: (columns.at(-1) ?? -1) + 1 },
      () => "",
    );
    for (const index of columns) kept[index] = record[index] ?? "";
    return kept;
  };
  try {
    for await (const record of parser as AsyncIterable<string[]>) {
      rowsRead++;
      if (rowsRead === 1 && /^\s*<(?:!doctype|html)/i.test(record[0] ?? ""))
        throw new Error("Expected CSV");
      if (rowsRead <= headerCount) {
        rows.push(record);
        if (rowsRead === headerCount) {
          checkSourceHeaders(rows, config, "attendance", true);
          if (wide && !wide.lastDateColumn) {
            const first = indexOf(wide.firstDateColumn);
            const header = rows[wide.dateHeaderRow - 1] ?? [];
            const dates = header.flatMap((value, index) =>
              index >= first &&
              parseDate(value, {
                dateOrder: config.dateOrder,
                window: { from: "2000-01-01", to: "2000-12-31" },
                ignoreYear: true,
              })
                ? [index]
                : [],
            );
            columns.splice(
              0,
              columns.length,
              ...[...new Set([...columns, ...dates])].sort((a, b) => a - b),
            );
          }
          if (
            columns.some((i) =>
              privateHeader(
                (rows[wide ? wide.dateHeaderRow - 1 : headerCount - 1] ?? [])[
                  i
                ] ?? "",
              ),
            )
          )
            throw new SourceAccessError(
              "A mapped column has a sensitive header. Review the column mapping.",
            );
          rows.splice(0, rows.length, ...rows.map(project));
        }
        continue;
      }
      const value = record[key];
      const code =
        wide?.keyType === "name" ? names.get(nameOf(value)) : codeOf(value);
      if (code && codes.has(code)) rows.push(project(record));
    }
    if (!bytes || rowsRead < headerCount) throw new Error("Incomplete CSV");
    if (rows.length <= headerCount) throw new SourceAccessError("NO_TEAM_ROWS");
    return { rows, rowsRead, bytes };
  } catch (error) {
    if (error instanceof SourceAccessError) throw error;
    throw new SourceAccessError(
      "Invalid CSV. Export the source as UTF-8 CSV and try again.",
    );
  } finally {
    stream.destroy();
    parser.destroy();
  }
}

function saveFiltered(folder: string, rows: string[][], timestamp?: Date) {
  const destination = join(folder, archiveName());
  const temporary = destination + ".tmp";
  const csv =
    rows
      .map((row) =>
        row.map((cell) => '"' + cell.replaceAll('"', '""') + '"').join(","),
      )
      .join("\n") + "\n";
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  try {
    writeFileSync(temporary, csv, { flag: "wx", mode: 0o600 });
    if (timestamp) utimesSync(temporary, timestamp, timestamp);
    renameSync(temporary, destination);
    return destination;
  } finally {
    if (lstatSync(temporary, { throwIfNoEntry: false })) unlinkSync(temporary);
  }
}

function archiveName() {
  return (
    new Date().toISOString().replace(/[:.]/g, "-") + "-" + randomUUID() + ".csv"
  );
}

export async function uploadAttendanceCsv(
  input: AsyncIterable<Buffer>,
  config: Config,
  dataDir: string,
  agents: Agent[],
) {
  const { rows } = await readAttendanceCsv(input, config, agents);
  const folder = inbox("attendance", dataDir);
  try {
    saveFiltered(folder, rows);
  } catch {
    throw new SourceAccessError(
      "Could not save the CSV to the attendance inbox.",
    );
  }
}

export async function loadSourceFile(
  config: Config,
  source: SourceKey,
  dataDir: string,
  agents: Agent[],
) {
  const folder = inbox(source, dataDir);
  const processed = join(folder, "processed");
  try {
    const files = [folder, processed].flatMap((directory) =>
      csvNames(directory).flatMap((name) => {
        const path = join(directory, name);
        const stat = lstatSync(path, { throwIfNoEntry: false });
        return stat?.isFile() ? [{ path, stat }] : [];
      }),
    );
    // Use the last successful drop when there is no newer incoming file.
    const newest = files.sort(
      (a, b) => b.stat.mtimeMs - a.stat.mtimeMs || b.path.localeCompare(a.path),
    )[0];
    if (!newest)
      throw new SourceAccessError("No CSV in the " + source + " inbox.");
    const { path, stat } = newest;
    if (stat.size > csvLimit)
      throw new SourceAccessError("The inbox CSV exceeds 150 MB.");
    const input = createReadStream(path);
    const result = await readAttendanceCsv(input, config, agents).finally(() =>
      input.destroy(),
    );
    return {
      ...result,
      archive() {
        try {
          if (dirname(path) === folder) {
            const current = lstatSync(path);
            if (
              current.ino !== stat.ino ||
              current.size !== stat.size ||
              current.mtimeMs !== stat.mtimeMs
            )
              throw new Error("CSV changed");
            const archive = saveFiltered(processed, result.rows, stat.mtime);
            try {
              unlinkSync(path);
            } catch (error) {
              unlinkSync(archive);
              throw error;
            }
          }
          const names = csvNames(processed).sort().reverse();
          for (const name of names.slice(14)) unlinkSync(join(processed, name));
        } catch {
          throw new SourceAccessError(
            "Could not archive the inbox CSV. Check the folder and retry.",
          );
        }
      },
    };
  } catch (error) {
    if (error instanceof SourceAccessError) throw error;
    throw new SourceAccessError("Could not read the " + source + " inbox CSV.");
  }
}

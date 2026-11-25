import { randomUUID } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { Config, SourceKey } from "../config.js";
import { decodeCsv, SourceAccessError } from "./fetchCsv.js";
import { checkSourceHeaders } from "./sourceColumns.js";

export const csvLimit = 32 * 1024 * 1024;

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

function csvRows(data: Buffer, config: Config, source: SourceKey) {
  if (!data.length || data.length > csvLimit)
    throw new SourceAccessError("Choose a nonempty CSV of at most 32 MB.");
  let rows: string[][];
  try {
    const content = new TextDecoder("utf-8", { fatal: true }).decode(data);
    if (/\0|^\s*<(?:!doctype|html)/i.test(content)) throw new Error();
    rows = decodeCsv(content);
    if (!rows.some((row) => row.some((value) => value.trim())))
      throw new Error();
  } catch {
    throw new SourceAccessError(
      "Invalid CSV. Export the source as UTF-8 CSV and try again.",
    );
  }
  checkSourceHeaders(rows, config, source, false);
  return rows;
}

function archiveName() {
  return (
    new Date().toISOString().replace(/[:.]/g, "-") + "-" + randomUUID() + ".csv"
  );
}

export function uploadAttendanceCsv(
  data: Buffer,
  config: Config,
  dataDir: string,
) {
  csvRows(data, config, "attendance");
  const folder = inbox("attendance", dataDir);
  const destination = join(folder, archiveName());
  const temporary = destination + ".tmp";
  try {
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    try {
      writeFileSync(temporary, data, { flag: "wx", mode: 0o600 });
      renameSync(temporary, destination);
    } finally {
      if (lstatSync(temporary, { throwIfNoEntry: false }))
        unlinkSync(temporary);
    }
  } catch {
    throw new SourceAccessError(
      "Could not save the CSV to the attendance inbox.",
    );
  }
}

export function loadSourceFile(
  config: Config,
  source: SourceKey,
  dataDir: string,
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
      throw new SourceAccessError("The inbox CSV exceeds 32 MB.");
    const rows = csvRows(readFileSync(path), config, source);
    return {
      rows,
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
            mkdirSync(processed, { recursive: true, mode: 0o700 });
            renameSync(path, join(processed, archiveName()));
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

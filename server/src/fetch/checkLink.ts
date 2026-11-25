import type { Config, SourceKey } from "../config.js";
import { indexOf } from "../parse/columns.js";
import { masterHeaderMismatches } from "../parse/master.js";
import { fetchCsv, SourceAccessError } from "./fetchCsv.js";
import { fetchGoogleRows } from "./googleSheets.js";
import { sampleSourceDate } from "./sampleDate.js";
import { privateHeader, sourceMapping } from "./sourceColumns.js";
import { exportUrl, parseLink } from "./urls.js";

export const sourceKeys = ["master", "schedule", "attendance"] as const;
export type CheckLinkInput = {
  link: string;
  gid?: string;
  source?: SourceKey;
  access?: "public" | "google";
};
type Header = { field: string; column: string; header: string | null };

export interface LinkReport {
  sheetId: string;
  gid: string;
  source: SourceKey | null;
  status: number | null;
  contentType: string | null;
  rowCount: number | null;
  headers: Header[];
  mismatches: string[];
  sampleDate: string | null;
  dateOrder: Config["dateOrder"];
  error: string | null;
}

const redirectStatuses = new Set([301, 302, 303, 307, 308]);

function safeExportFetch(request: typeof fetch): typeof fetch {
  return async (input, options) => {
    let url = new URL(String(input));
    for (let count = 0; ; count++) {
      const response = await request(url.href, {
        ...options,
        redirect: "manual",
      });
      if (!redirectStatuses.has(response.status)) return response;
      const location = response.headers.get("location");
      await response.body?.cancel();
      const next =
        location && URL.canParse(location, url) ? new URL(location, url) : null;
      if (
        count >= 3 ||
        next?.protocol !== "https:" ||
        next.port ||
        next.username ||
        next.password ||
        !/^doc-[a-z0-9-]+-sheets\.googleusercontent\.com$/.test(
          next.hostname,
        ) ||
        !next.pathname.startsWith("/export/")
      ) {
        throw new SourceAccessError(
          "Google Sheets returned an unsupported export redirect",
          response.status,
        );
      }
      url = next;
    }
  };
}

function mappedHeaders(config: Config, source: SourceKey, rows: string[][]) {
  const { fields, headerRows } = sourceMapping(config, source);
  return Object.entries(fields).flatMap(([field, column]): Header[] => {
    if (!column) return [];
    const value = rows[headerRows - 1]?.[indexOf(column)]?.trim();
    const header =
      value &&
      value.length <= 80 &&
      !privateHeader(value) &&
      !value.includes("@") &&
      !/^\+?\d[\d ()-]{6,}$/.test(value)
        ? value
        : null;
    return [{ field, column, header }];
  });
}

export async function checkSheetLink(
  input: CheckLinkInput,
  config: Config,
  request = fetch,
  dataDir = ":memory:",
): Promise<LinkReport> {
  const parsed = parseLink(input.link);
  const { sheetId } = parsed;
  const gid = input.gid || parsed.gid;
  if (!/^\d+$/.test(gid)) throw new Error("Expected a numeric tab GID");
  const source =
    input.source ??
    sourceKeys.find(
      (key) =>
        config.sources[key].sheetId === sheetId &&
        config.sources[key].gid === gid,
    ) ??
    null;
  const base = { sheetId, gid, source, dateOrder: config.dateOrder };
  const settings = source ? config.sources[source] : null;
  const google = (input.access ?? settings?.access) === "google";
  try {
    if (
      google &&
      (!source ||
        settings?.access !== "google" ||
        settings.sheetId !== sheetId ||
        settings.gid !== gid)
    )
      throw new SourceAccessError(
        "Choose the configured Google source and its exact tab link.",
      );
    const result =
      google && source
        ? await fetchGoogleRows(config, source, dataDir, request, true)
        : await fetchCsv(
            exportUrl(sheetId, gid),
            safeExportFetch(request),
            undefined,
            32 * 1024 * 1024,
          );
    const headers = source ? mappedHeaders(config, source, result.rows) : [];
    const mismatchedFields =
      source === "master" ? masterHeaderMismatches(result.rows, config) : [];
    return {
      ...base,
      status: result.status,
      contentType: result.contentType,
      rowCount: result.rows.length,
      headers,
      mismatches: mismatchedFields.map(
        (field) => "COLUMN_HEADER_MISMATCH:" + field,
      ),
      sampleDate: source ? sampleSourceDate(result.rows, config, source) : null,
      error: null,
    };
  } catch (error) {
    const access = error instanceof SourceAccessError ? error : null;
    return {
      ...base,
      status: access?.status ?? null,
      contentType: access?.contentType ?? null,
      rowCount: null,
      headers: [],
      mismatches: [],
      sampleDate: null,
      error:
        access?.message ??
        (google
          ? "Google Sheets API request failed"
          : "Google Sheets CSV download failed"),
    };
  }
}

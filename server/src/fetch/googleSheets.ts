import type { Config, SourceKey } from "../config.js";
import { columnAt, indexOf } from "../parse/columns.js";
import { SourceAccessError } from "./fetchCsv.js";
import {
  adminBlocked,
  googleAccessToken,
  googleJson,
  googleRequest,
  loginRequired,
  safeGoogleMessage,
} from "./googleAuth.js";
import { checkSourceHeaders, sourceColumnIndices } from "./sourceColumns.js";

function mappedRanges(config: Config, source: SourceKey) {
  const columns = sourceColumnIndices(config, source);
  const ranges: { start: number; end: number; header?: number }[] = [];
  const schedule = config.sources.schedule;
  const stop =
    source === "schedule" && schedule.stopColumn
      ? indexOf(schedule.stopColumn)
      : -1;
  for (const index of columns) {
    const last = ranges.at(-1);
    if (index === stop)
      ranges.push({ start: index, end: index, header: schedule.headerRows });
    else if (last && !last.header && last.end + 1 === index) last.end = index;
    else ranges.push({ start: index, end: index });
  }
  return ranges;
}

export async function fetchGoogleRows(
  config: Config,
  source: SourceKey,
  dataDir: string,
  request = fetch,
  diagnostic = false,
) {
  const { sheetId, tab } = config.sources[source];
  if (!sheetId || !tab.trim())
    throw new SourceAccessError(
      "Configure the Google spreadsheet ID and exact tab name.",
    );
  const { accessToken, refreshToken } = await googleAccessToken(
    dataDir,
    request,
  );
  const secrets = [
    accessToken,
    refreshToken,
    sheetId,
    process.env.GOOGLE_OAUTH_CLIENT_ID ?? "",
    process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? "",
  ];
  const rows: string[][] = [];
  for (const { start, end, header } of mappedRanges(config, source)) {
    const first = columnAt(start);
    const a1 =
      "'" +
      tab.replaceAll("'", "''") +
      "'!" +
      (header ? first + header : first + ":" + columnAt(end));
    const url = new URL(
      "https://sheets.googleapis.com/v4/spreadsheets/" +
        sheetId +
        "/values/" +
        encodeURIComponent(a1),
    );
    url.searchParams.set("valueRenderOption", "FORMATTED_VALUE");
    const response = await googleRequest(
      url,
      { headers: { Authorization: "Bearer " + accessToken } },
      request,
    );
    if (response.status === 401) {
      await response.body?.cancel();
      throw new SourceAccessError(loginRequired, 401);
    }
    if (!response.ok) {
      const body = (await googleJson(response).catch(() => null)) as {
        error?: { message?: unknown; details?: { reason?: unknown }[] };
      } | null;
      const error = body?.error;
      const message = typeof error?.message === "string" ? error.message : "";
      const detail = Array.isArray(error?.details)
        ? error.details.find(
            (item) =>
              typeof item?.reason === "string" && adminBlocked(item.reason),
          )?.reason
        : null;
      throw new SourceAccessError(
        detail || adminBlocked(message)
          ? safeGoogleMessage(message || String(detail), secrets)
          : response.status === 403
            ? "Your account can't view this sheet"
            : "Google Sheets returned HTTP " +
              response.status +
              ". Check the configured tab and columns.",
        response.status,
      );
    }
    const body = (await googleJson(response, 32 * 1024 * 1024)) as {
      values?: unknown;
    } | null;
    const values = body?.values ?? [];
    if (!Array.isArray(values))
      throw new SourceAccessError(
        "Google Sheets returned invalid display values",
      );
    for (const [offset, cells] of values.entries()) {
      if (
        !Array.isArray(cells) ||
        cells.length > end - start + 1 ||
        (header && offset > 0)
      )
        throw new SourceAccessError(
          "Google Sheets returned invalid display values",
        );
      if (!cells.length) continue;
      const index = header ? header - 1 : offset;
      const row = (rows[index] ??= []);
      for (const [column, value] of cells.entries()) {
        if (
          typeof value !== "string" &&
          typeof value !== "number" &&
          typeof value !== "boolean"
        )
          throw new SourceAccessError(
            "Google Sheets returned invalid display values",
          );
        row[start + column] =
          typeof value === "boolean"
            ? String(value).toUpperCase()
            : String(value);
      }
    }
  }
  for (let i = 0; i < rows.length; i++) {
    const row = (rows[i] ??= []);
    for (let column = 0; column < row.length; column++) row[column] ??= "";
  }
  checkSourceHeaders(rows, config, source, true, diagnostic);
  return { rows, status: 200, contentType: "application/json" };
}

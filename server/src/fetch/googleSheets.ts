import type { Config, SourceKey } from "../config.js";
import { columnAt, indexOf } from "../parse/columns.js";
import { labelOf } from "../parse/normalize.js";
import { SourceAccessError } from "./fetchCsv.js";
import {
  adminBlocked,
  googleAccessToken,
  googleJson,
  googleRequest,
  loginRequired,
  safeGoogleMessage,
} from "./googleAuth.js";
import {
  checkSourceHeaders,
  patientOrCallerHeader,
  refusedHeader,
  sourceColumnIndices,
} from "./sourceColumns.js";

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

function googleError(
  response: Response,
  body: {
    error?: { message?: unknown; details?: { reason?: unknown }[] };
  } | null,
  secrets: string[],
  fallback: string,
) {
  const error = body?.error;
  const message = typeof error?.message === "string" ? error.message : "";
  const detail = Array.isArray(error?.details)
    ? error.details.find(
        (item) => typeof item?.reason === "string" && adminBlocked(item.reason),
      )?.reason
    : null;
  return new SourceAccessError(
    detail || adminBlocked(message)
      ? safeGoogleMessage(message || String(detail), secrets)
      : response.status === 403
        ? "Your account can't view this sheet"
        : fallback,
    response.status,
  );
}

export async function fetchGoogleTabRows(
  sheetId: string,
  gid: string,
  dataDir: string,
  options: {
    range?: string;
    valueRenderOption?: "FORMATTED_VALUE" | "UNFORMATTED_VALUE";
    dateTimeRenderOption?: "SERIAL_NUMBER" | "FORMATTED_STRING";
  } = {},
  request = fetch,
): Promise<(string | number | boolean)[][]> {
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
  const metaRes = await googleRequest(
    "https://sheets.googleapis.com/v4/spreadsheets/" +
      sheetId +
      "?fields=sheets(properties(sheetId,title))",
    { headers: { Authorization: "Bearer " + accessToken } },
    request,
  );
  if (metaRes.status === 401) {
    await metaRes.body?.cancel();
    throw new SourceAccessError(loginRequired, 401);
  }
  const metaBody = (await googleJson(metaRes).catch(() => null)) as {
    sheets?: { properties?: { sheetId?: number; title?: string } }[];
    error?: { message?: unknown; details?: { reason?: unknown }[] };
  } | null;
  if (!metaRes.ok)
    throw googleError(
      metaRes,
      metaBody,
      secrets,
      "Google Sheets returned HTTP " + metaRes.status + ".",
    );
  const tab = metaBody?.sheets?.find(
    (s) => String(s.properties?.sheetId ?? "") === gid,
  )?.properties?.title;
  if (!tab) throw new SourceAccessError("Could not find tab gid " + gid + ".");
  const a1 =
    "'" +
    tab.replaceAll("'", "''") +
    "'" +
    (options.range ? "!" + options.range : "");
  const url = new URL(
    "https://sheets.googleapis.com/v4/spreadsheets/" +
      sheetId +
      "/values/" +
      encodeURIComponent(a1),
  );
  url.searchParams.set(
    "valueRenderOption",
    options.valueRenderOption ?? "FORMATTED_VALUE",
  );
  if (options.dateTimeRenderOption)
    url.searchParams.set("dateTimeRenderOption", options.dateTimeRenderOption);
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
    throw googleError(
      response,
      body,
      secrets,
      "Google Sheets returned HTTP " +
        response.status +
        ". Check the configured tab and columns.",
    );
  }
  const body = (await googleJson(response, 32 * 1024 * 1024)) as {
    values?: unknown;
  } | null;
  const values = body?.values ?? [];
  if (!Array.isArray(values))
    throw new SourceAccessError("Google Sheets returned invalid values");
  return values.map((row) => {
    if (!Array.isArray(row))
      throw new SourceAccessError("Google Sheets returned invalid values");
    return row.map((cell) => {
      if (cell === null || cell === undefined) return "";
      if (
        typeof cell !== "string" &&
        typeof cell !== "number" &&
        typeof cell !== "boolean"
      )
        throw new SourceAccessError("Google Sheets returned invalid values");
      return cell;
    });
  });
}

export async function fetchGoogleMappedTabRows(
  sheetId: string,
  gid: string,
  headerRows: number,
  expectedHeaders: string[],
  dataDir: string,
  request = fetch,
): Promise<(string | number | boolean)[][]> {
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
  const metaRes = await googleRequest(
    "https://sheets.googleapis.com/v4/spreadsheets/" +
      sheetId +
      "?fields=sheets(properties(sheetId,title))",
    { headers: { Authorization: "Bearer " + accessToken } },
    request,
  );
  if (metaRes.status === 401) {
    await metaRes.body?.cancel();
    throw new SourceAccessError(loginRequired, 401);
  }
  const metaBody = (await googleJson(metaRes).catch(() => null)) as {
    sheets?: { properties?: { sheetId?: number; title?: string } }[];
    error?: { message?: unknown; details?: { reason?: unknown }[] };
  } | null;
  if (!metaRes.ok)
    throw googleError(
      metaRes,
      metaBody,
      secrets,
      "Google Sheets returned HTTP " + metaRes.status + ".",
    );
  const tab = metaBody?.sheets?.find(
    (s) => String(s.properties?.sheetId ?? "") === gid,
  )?.properties?.title;
  if (!tab) throw new SourceAccessError("Could not find tab gid " + gid + ".");
  const qualified = (range: string) =>
    "'" + tab.replaceAll("'", "''") + "'!" + range;

  const headerUrl = new URL(
    "https://sheets.googleapis.com/v4/spreadsheets/" +
      sheetId +
      "/values/" +
      encodeURIComponent(qualified(headerRows + ":" + headerRows)),
  );
  headerUrl.searchParams.set("valueRenderOption", "FORMATTED_VALUE");
  const headerRes = await googleRequest(
    headerUrl,
    { headers: { Authorization: "Bearer " + accessToken } },
    request,
  );
  if (headerRes.status === 401) {
    await headerRes.body?.cancel();
    throw new SourceAccessError(loginRequired, 401);
  }
  if (!headerRes.ok) {
    const body = (await googleJson(headerRes).catch(() => null)) as {
      error?: { message?: unknown; details?: { reason?: unknown }[] };
    } | null;
    throw googleError(
      headerRes,
      body,
      secrets,
      "Google Sheets returned HTTP " + headerRes.status + ".",
    );
  }
  const headerBody = (await googleJson(headerRes)) as {
    values?: unknown[][];
  } | null;
  const headerRow = (headerBody?.values?.[0] ?? []).map((cell) =>
    cell === null || cell === undefined ? "" : String(cell),
  );
  if (headerRow.some(patientOrCallerHeader))
    throw new SourceAccessError(
      "Possible patient or caller data in QA headers. Stop and review the source.",
    );

  const indices: number[] = [];
  for (const expected of expectedHeaders) {
    const hits = headerRow.flatMap((value, i) =>
      labelOf(value) === labelOf(expected) ? [i] : [],
    );
    if (
      hits.length !== 1 ||
      refusedHeader(expected) ||
      refusedHeader(headerRow[hits[0]] ?? "")
    )
      throw new SourceAccessError("Approved QA header is missing or refused");
    indices.push(hits[0]);
  }
  const sorted = [...new Set(indices)].sort((a, b) => a - b);
  const groups: { start: number; end: number }[] = [];
  for (const index of sorted) {
    const previous = groups.at(-1);
    if (previous && previous.end + 1 === index) previous.end = index;
    else groups.push({ start: index, end: index });
  }
  const params = new URLSearchParams({
    valueRenderOption: "UNFORMATTED_VALUE",
    dateTimeRenderOption: "SERIAL_NUMBER",
    fields: "valueRanges(values)",
  });
  for (const { start, end } of groups)
    params.append(
      "ranges",
      qualified(columnAt(start) + (headerRows + 1) + ":" + columnAt(end)),
    );
  const dataRes = await googleRequest(
    "https://sheets.googleapis.com/v4/spreadsheets/" +
      sheetId +
      "/values:batchGet?" +
      params,
    { headers: { Authorization: "Bearer " + accessToken } },
    request,
  );
  if (dataRes.status === 401) {
    await dataRes.body?.cancel();
    throw new SourceAccessError(loginRequired, 401);
  }
  const dataBody = (await googleJson(dataRes, 32 * 1024 * 1024)) as {
    valueRanges?: { values?: unknown[][] }[];
    error?: { message?: unknown; details?: { reason?: unknown }[] };
  } | null;
  if (!dataRes.ok)
    throw googleError(
      dataRes,
      dataBody,
      secrets,
      "Google Sheets returned HTTP " + dataRes.status + ".",
    );
  if (dataBody?.valueRanges?.length !== groups.length)
    throw new SourceAccessError("Google returned incomplete QA ranges.");

  const rows: (string | number | boolean)[][] = Array.from(
    { length: headerRows },
    () => [],
  );
  for (const index of sorted) rows[headerRows - 1][index] = headerRow[index];
  for (const [groupIndex, { start, end }] of groups.entries()) {
    const values = dataBody.valueRanges[groupIndex].values ?? [];
    for (const [offset, cells] of values.entries()) {
      if (!Array.isArray(cells) || cells.length > end - start + 1)
        throw new SourceAccessError("Google Sheets returned invalid values");
      const row = (rows[headerRows + offset] ??= []);
      for (const [colOffset, cell] of cells.entries()) {
        if (cell === null || cell === undefined) continue;
        if (
          typeof cell !== "string" &&
          typeof cell !== "number" &&
          typeof cell !== "boolean"
        )
          throw new SourceAccessError("Google Sheets returned invalid values");
        row[start + colOffset] = cell;
      }
    }
  }
  return rows;
}

import { columnAt, indexOf } from "../parse/columns.js";
import { labelOf } from "../parse/normalize.js";
import { SourceAccessError } from "./fetchCsv.js";
import {
  adminBlocked,
  googleAccessToken,
  googleJson,
  googleRequest,
} from "./googleAuth.js";
import {
  patientHeader,
  privateHeader,
  pastePrivateHeader,
} from "./sourceColumns.js";

export const pasteTabs = ["Attendance", "MTD", "Team View"] as const;
export type PasteTab = (typeof pasteTabs)[number];
type Cell = string | number | boolean;
export type PasteRow = Record<string, Cell | undefined>;

const fields = {
  Attendance: {
    code: "Code",
    name: "Name",
    leader: "Team Leader",
    date: "Date",
    shift: "Scheduled Shift",
    status: "Status",
    login: "Login Time",
    logout: "Logout Time",
    lateness: "Lateness",
    breakOver: "Duration Of break Exceeding",
    exceeded: "Exceeded",
    ncnsStreak: "NCNS Streak",
    missing: "Missing After Compensation",
    tlComment: "TL Comment",
  },
  MTD: {
    leader: "Team Leader",
    code: "Employee ID",
    name: "Agent Name",
    missing: "Total Missing Hours",
    ot: "Total OT Hours",
    lateness: "Lateness mins",
    latenessIncidents: "Lateness Incidents",
    deductedDays: "Total deducted days",
    status: "Status",
  },
  "Team View": { code: "Code" },
} as const;
const mtdCounts = new Set([
  "active - site",
  "active - remote",
  "off",
  "annual",
  "casual",
  "public holiday",
  "sick",
  "upl",
  "ncns",
  "awol",
  "resigned",
  "dropped",
  "terminated",
  "not hired",
  "on hold",
  "maternity",
  "marriage leave",
  "forced upl",
  "forced annual",
  ...["1st", "2nd"].flatMap((half) =>
    ["ann", "annual", "upl", "forced upl", "forced ann", "forced annual"].map(
      (label) => half + " half " + label,
    ),
  ),
]);
const headerRow = (tab: PasteTab) => (tab === "MTD" ? 4 : 1);
export const pasteColumn = (tab: PasteTab, field: string) =>
  field.startsWith("count:")
    ? field.slice(6)
    : ((fields[tab] as Record<string, string>)[field] ?? field);
const qualified = (tab: PasteTab, range: string) => "'" + tab + "'!" + range;

function mapColumns(tab: PasteTab, headers: Cell[], reportOnly: boolean) {
  const selected = new Map<string, number>();
  for (const [field, header] of Object.entries(fields[tab])) {
    if (reportOnly && field !== "code") continue;
    const matches = headers.flatMap((value, i) =>
      labelOf(String(value)) === labelOf(header) ? [i] : [],
    );
    if (field === "tlComment" && matches.length === 0) continue;
    if (
      matches.length !== 1 ||
      (tab === "Attendance" ? pastePrivateHeader : privateHeader)(
        String(headers[matches[0]]),
      )
    )
      throw new SourceAccessError(tab + " requires one " + header + " header.");
    selected.set(field, matches[0]);
  }
  if (tab === "MTD" && !reportOnly) {
    const seen = new Set<string>();
    for (let index = indexOf("H"); index <= indexOf("AH"); index++) {
      const header = String(headers[index] ?? "").trim(),
        label = labelOf(header);
      if (!mtdCounts.has(label)) continue;
      if (seen.has(label))
        throw new SourceAccessError("MTD has duplicate status count headers.");
      seen.add(label);
      selected.set("count:" + label, index);
    }
    if (!seen.size)
      throw new SourceAccessError("MTD status count headers are missing.");
  }
  return selected;
}

function csvHeaders(headers: Cell[]) {
  return headers.flatMap((value, index) => {
    const header = String(value).trim();
    if (!header) return [];
    return [
      {
        column: columnAt(index),
        header:
          typeof value === "string" &&
          header.length <= 100 &&
          !privateHeader(header) &&
          !/@|\+?\d{7,}/.test(header)
            ? header
            : "[excluded]",
      },
    ];
  });
}

export async function readAttendancePasteTabs(
  sheetId: string,
  dataDir: string,
  tabs: PasteTab[],
  reportOnly = false,
  request = fetch,
) {
  const { accessToken } = await googleAccessToken(dataDir, request);
  async function batch(ranges: string[]) {
    const params = new URLSearchParams({
      valueRenderOption: "UNFORMATTED_VALUE",
      dateTimeRenderOption: "SERIAL_NUMBER",
      fields: "valueRanges(values)",
    });
    for (const range of ranges) params.append("ranges", range);
    const response = await googleRequest(
      "https://sheets.googleapis.com/v4/spreadsheets/" +
        sheetId +
        "/values:batchGet?" +
        params,
      { headers: { Authorization: "Bearer " + accessToken } },
      request,
    );
    const body = (await googleJson(response, 32 * 1024 * 1024)) as {
      valueRanges?: { values?: Cell[][] }[];
    };
    if (!response.ok)
      throw new SourceAccessError(
        adminBlocked(JSON.stringify(body))
          ? "Google blocked access under the administrator policy."
          : "Attendance Sheets API returned HTTP " + response.status + ".",
      );
    if (body?.valueRanges?.length !== ranges.length)
      throw new SourceAccessError(
        "Google returned incomplete attendance ranges.",
      );
    return body.valueRanges.map((item) => item.values ?? []);
  }
  const hasMtd = tabs.includes("MTD");
  const headerData = await batch([
    ...tabs.map((tab) => qualified(tab, headerRow(tab) + ":" + headerRow(tab))),
    ...(hasMtd ? [qualified("MTD", "D1:E3")] : []),
  ]);
  if (headerData.flat(2).some((value) => patientHeader(String(value))))
    throw new SourceAccessError(
      "Possible patient data in the source headers. Stop and review the source.",
    );

  const plans = tabs.map((tab, i) => {
    const headers = [...(headerData[i][0] ?? [])];
    if (tab === "MTD") {
      for (const [offset, title] of [
        "Total Missing Hours",
        "Total OT Hours",
      ].entries()) {
        if (!headers[indexOf("D") + offset]) {
          const label = headerData[tabs.length]
            .map((row) => row[offset])
            .find((value) => labelOf(String(value ?? "")) === labelOf(title));
          if (label !== undefined) headers[indexOf("D") + offset] = label;
        }
      }
    }
    const emptyMtd =
      tab === "MTD" &&
      !headers.some((value) => String(value ?? "").trim()) &&
      !headerData[tabs.length]
        .flat()
        .some((value) => String(value ?? "").trim());
    return {
      tab,
      headers,
      selected: emptyMtd
        ? new Map<string, number>()
        : mapColumns(tab, headers, reportOnly),
    };
  });
  const ranges = plans.flatMap((plan, tabIndex) => {
    const sorted = [...plan.selected].sort((a, b) => a[1] - b[1]);
    const groups: { tabIndex: number; columns: typeof sorted }[] = [];
    for (const item of sorted) {
      const previous = groups.at(-1);
      if (previous?.columns.at(-1)?.[1] === item[1] - 1)
        previous.columns.push(item);
      else groups.push({ tabIndex, columns: [item] });
    }
    return groups;
  });
  const raw = ranges.length
    ? await batch(
        ranges.map(({ tabIndex, columns }) => {
          const tab = plans[tabIndex].tab;
          return qualified(
            tab,
            columnAt(columns[0][1]) +
              (headerRow(tab) + 1) +
              ":" +
              columnAt(columns.at(-1)![1]),
          );
        }),
      )
    : [];
  const rows = plans.map(() => [] as PasteRow[]);
  for (const [i, { tabIndex, columns }] of ranges.entries()) {
    for (const [offset, values] of raw[i].entries()) {
      const row = (rows[tabIndex][offset] ??= {});
      for (const [field, index] of columns)
        row[field] = values[index - columns[0][1]];
    }
  }
  return plans.map(({ tab, headers }, i) => ({
    tab,
    headers: csvHeaders(headers),
    rows: rows[i].filter((row) => String(row.code ?? "").trim()),
  }));
}

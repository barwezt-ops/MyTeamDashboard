import type { DiscrepancyRow } from "./dto.js";
const headers = [
  "Code",
  "Name",
  "Team Leader",
  "Account",
  "Date",
  "Missing",
  "TL Comment",
];
const htmlEscape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ] ?? char,
  );
export function exportDiscrepancies(rows: DiscrepancyRow[]) {
  const values = rows.map((row) => [
    row.code,
    row.firstName,
    row.tl,
    row.account,
    row.date,
    row.missing,
    row.tlComment,
  ]);
  const style =
    "border:1px solid #000;padding:4px 7px;font-family:Arial,sans-serif;font-size:11pt;";
  const header = headers
    .map(
      (value) =>
        '<th style="' +
        style +
        'background-color:#16365c;color:#fff;font-weight:bold;">' +
        value +
        "</th>",
    )
    .join("");
  const body = values
    .map(
      (row) =>
        "<tr>" +
        row
          .map(
            (value) =>
              '<td style="' +
              style +
              '">' +
              htmlEscape(value).replace(/\r?\n/g, "<br>") +
              "</td>",
          )
          .join("") +
        "</tr>",
    )
    .join("");
  return {
    html:
      '<table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:11pt;"><thead><tr>' +
      header +
      "</tr></thead><tbody>" +
      body +
      "</tbody></table>",
    tsv: [headers, ...values]
      .map((row) =>
        row.map((value) => value.replace(/[\t\r\n]+/g, " ")).join("\t"),
      )
      .join("\n"),
  };
}

// Copy-to-clipboard tables in the email style, plus CSV downloads.
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ] ?? char,
  );
const flat = (value: string) => value.replace(/[\t\r\n]+/g, " ");

export type Table = { headers: string[]; rows: string[][] };

export function tableText({ headers, rows }: Table) {
  return [headers, ...rows].map((row) => row.map(flat).join("\t")).join("\n");
}

export function tableHtml({ headers, rows }: Table) {
  const style =
    "border:1px solid #000;padding:4px 7px;font-family:Arial,sans-serif;font-size:11pt;";
  const cells = (row: string[], tag: "th" | "td", extra = "") =>
    row
      .map(
        (value) =>
          `<${tag} style="${style}${extra}">${escape(value).replace(/\r?\n/g, "<br>")}</${tag}>`,
      )
      .join("");
  return (
    '<table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:11pt;"><thead><tr>' +
    cells(
      headers,
      "th",
      "background-color:#16365c;color:#fff;font-weight:bold;",
    ) +
    "</tr></thead><tbody>" +
    rows.map((row) => `<tr>${cells(row, "td")}</tr>`).join("") +
    "</tbody></table>"
  );
}

export async function copy(text: string, html?: string) {
  if (!navigator.clipboard)
    throw new Error("Copying needs a secure (https or localhost) page.");
  if (html && typeof ClipboardItem !== "undefined" && navigator.clipboard.write)
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([text], { type: "text/plain" }),
      }),
    ]);
  else await navigator.clipboard.writeText(text);
}

/** Cells that a spreadsheet could read as a formula are prefixed. */
export function csv({ headers, rows }: Table) {
  const cell = (value: string) => {
    const safe = /^[=+\-@\t\r]/.test(value) ? "'" + value : value;
    return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return [headers, ...rows].map((row) => row.map(cell).join(",")).join("\r\n");
}

export function downloadCsv(name: string, table: Table) {
  const url = URL.createObjectURL(
    new Blob(["﻿" + csv(table)], { type: "text/csv;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

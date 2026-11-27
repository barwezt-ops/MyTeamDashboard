import { api, query } from "../api";
import { copy, tableHtml } from "./copy";
import type { ReportsData } from "../views/Reports";

/**
 * Copies the end-of-day report in the owner's layout, for a date or for the
 * latest reported day.
 */
export async function copyEod(date?: string) {
  const report = api<ReportsData>("/v2/reports" + query({ date })).then(
    ({ eod }) => {
      if (!eod.text)
        throw new Error("There is nothing to report for that day.");
      return eod;
    },
  );
  if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
    const eod = await report;
    return copy(eod.text);
  }
  // Safari only allows a write started by the click itself, so the clipboard
  // item is created now and filled when the report arrives.
  const blob = (type: string, text: string) => new Blob([text], { type });
  const write = navigator.clipboard.write([
    new ClipboardItem({
      "text/plain": report.then((eod) => blob("text/plain", eod.text)),
      "text/html": report.then((eod) =>
        blob(
          "text/html",
          tableHtml(
            eod.table ?? {
              headers: [eod.text.split("\n")[0]],
              rows: eod.text
                .split("\n")
                .slice(1)
                .map((line) => [line]),
            },
          ),
        ),
      ),
    }),
  ]);
  // A failed load explains itself better than the clipboard does.
  await Promise.all([report, write]);
}

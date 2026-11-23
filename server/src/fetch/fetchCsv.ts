import { setTimeout as delay } from "node:timers/promises";
import { parse } from "csv-parse/sync";
export class SourceAccessError extends Error {}
export function decodeCsv(body: string): string[][] {
  return parse(body, {
    bom: true,
    relax_column_count: true,
    skip_empty_lines: false,
  });
}
export async function fetchCsv(url: string, request = fetch, backoff = delay) {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await request(url, {
        redirect: "follow",
        signal: AbortSignal.timeout(30_000),
      });
      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.toLowerCase().includes("text/html")) {
        await response.body?.cancel();
        throw new SourceAccessError("link no longer public or moved");
      }
      if (!response.ok) {
        await response.body?.cancel();
        const message = "Source returned HTTP " + response.status;
        if (response.status < 500 && response.status !== 429)
          throw new SourceAccessError(message);
        throw new Error(message);
      }
      const body = await response.text();
      if (/^\s*(?:<!doctype|<html\b)/i.test(body))
        throw new SourceAccessError("link no longer public or moved");
      let rows: string[][];
      try {
        rows = decodeCsv(body);
      } catch {
        throw new SourceAccessError("Source returned invalid CSV");
      }
      const bytes = Buffer.byteLength(body);
      return { rows, bytes, status: response.status, contentType };
    } catch (error) {
      if (error instanceof SourceAccessError) throw error;
      if (attempt === 2)
        throw new Error(
          "CSV download failed after 3 attempts" +
            (error instanceof Error ? ": " + error.message : ""),
        );
      await backoff(500 * 2 ** attempt);
    }
  }
}

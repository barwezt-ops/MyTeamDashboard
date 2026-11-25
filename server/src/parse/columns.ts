import { clean } from "./normalize.js";
export function indexOf(column: string) {
  return (
    [...column].reduce(
      (index, letter) => index * 26 + letter.charCodeAt(0) - 64,
      0,
    ) - 1
  );
}
export function columnAt(index: number) {
  let letters = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26))
    letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
  return letters;
}
export function pick<K extends string>(
  row: string[],
  columns: Record<K, string>,
): Record<K, string> {
  return Object.fromEntries(
    Object.entries<string>(columns).map(([key, column]) => [
      key,
      clean(row[indexOf(column)]),
    ]),
  ) as Record<K, string>;
}
export function checkColumns(
  rows: string[][],
  fields: Record<string, string>,
  start: number,
) {
  const data = rows
    .slice(start)
    .filter((row) => row.some((value) => value.trim() !== ""));
  const warnings: string[] = [];
  for (const [key, column] of Object.entries(fields)) {
    const index = indexOf(column);
    if (!rows.some((row) => index < row.length))
      throw new Error("MISSING_REQUIRED_COLUMN:" + key);
    if (
      data.length &&
      data.filter((row) => !clean(row[index])).length > data.length / 2
    )
      warnings.push("COLUMN_LOOKS_WRONG:" + key);
  }
  return warnings;
}

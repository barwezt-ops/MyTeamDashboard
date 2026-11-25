export const clean = (value = "") =>
  /^#(?:REF!|N\/A|VALUE!|DIV\/0!|NAME\?|NUM!|NULL!|ERROR!)$/i.test(value.trim())
    ? ""
    : value.trim();
export const codeOf = (value?: string) => clean(value).replace(/\.0$/, "");
export const labelOf = (value = "") =>
  clean(value).toLowerCase().replace(/\s+/g, " ");
export const nameOf = (value = "") => labelOf(value.replace(/\p{P}/gu, ""));
const months =
  "january february march april may june july august september october november december".split(
    " ",
  );
export function isoDate(year: number, month: number, day: number) {
  if (year < 1000 || year > 9999) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? date.toISOString().slice(0, 10)
    : null;
}
export type DateOrder = "MDY" | "DMY";
export function parseDate(
  value: string,
  {
    window,
    ignoreYear = false,
    dateOrder = "MDY",
  }: {
    window?: { from: string; to: string };
    ignoreYear?: boolean;
    dateOrder?: DateOrder;
  } = {},
) {
  const raw = clean(value).toLowerCase();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
  const named = /^(\d{1,2})-([a-z]{3})$|^([a-z]{3})-(\d{1,2})$/.exec(raw);
  const namedWithYear =
    /^(?:([a-z]{3,9})\s+(\d{1,2})|(\d{1,2})\s+([a-z]{3,9}))(?:,\s*|\s+)(\d{4})$/.exec(
      raw,
    );
  let year: number | null;
  let month: number;
  let day: number;
  if (iso) {
    year = +iso[1];
    month = +iso[2];
    day = +iso[3];
  } else if (slash) {
    year = +slash[3];
    month = +slash[dateOrder === "DMY" ? 2 : 1];
    day = +slash[dateOrder === "DMY" ? 1 : 2];
  } else {
    const monthName =
      namedWithYear?.[1] ?? namedWithYear?.[4] ?? named?.[2] ?? named?.[3];
    const dayText =
      namedWithYear?.[2] ?? namedWithYear?.[3] ?? named?.[1] ?? named?.[4];
    if (!monthName || !dayText) return null;
    month =
      months.findIndex(
        (name) => name === monthName || name.slice(0, 3) === monthName,
      ) + 1;
    day = +dayText;
    year = namedWithYear ? +namedWithYear[5] : null;
  }
  if (year !== null && !ignoreYear) return isoDate(year, month, day);
  if (!window) return null;
  const matches = [];
  for (let y = +window.from.slice(0, 4); y <= +window.to.slice(0, 4); y++) {
    const date = isoDate(y, month, day);
    if (date && date >= window.from && date <= window.to) matches.push(date);
  }
  return matches.length === 1 ? matches[0] : null;
}
export function plusDays(date: string, count: number) {
  return new Date(Date.parse(date) + count * 86400000)
    .toISOString()
    .slice(0, 10);
}
export const weekday = (date: string) => new Date(date).getUTCDay();
export const weekdays = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
export function localDate(timeZone: string, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).formatToParts(now);
  return ["year", "month", "day"]
    .map((type) => parts.find((part) => part.type === type)?.value)
    .join("-");
}

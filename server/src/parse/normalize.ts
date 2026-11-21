export const clean = (value = "") =>
  /^#(?:REF!|N\/A|VALUE!|DIV\/0!|NAME\?|NUM!|NULL!|ERROR!)$/i.test(value.trim())
    ? ""
    : value.trim();
export const codeOf = (value?: string) => clean(value).replace(/\.0$/, "");
export const labelOf = (value = "") =>
  clean(value).toLowerCase().replace(/\s+/g, " ");
export const nameOf = (value = "") => labelOf(value.replace(/\p{P}/gu, ""));
const months = "jan feb mar apr may jun jul aug sep oct nov dec".split(" ");
export function isoDate(year: number, month: number, day: number) {
  if (year < 1000 || year > 9999) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? date.toISOString().slice(0, 10)
    : null;
}
export function parseDate(
  value: string,
  window?: { from: string; to: string },
  ignoreYear = false,
) {
  const raw = clean(value).toLowerCase();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
  const named = /^(\d{1,2})-([a-z]{3})$|^([a-z]{3})-(\d{1,2})$/.exec(raw);
  if (!iso && !slash && !named) return null;
  const year = iso ? +iso[1] : slash ? +slash[3] : null;
  const month = iso
    ? +iso[2]
    : slash
      ? +slash[1]
      : months.indexOf(named![2] || named![3]) + 1;
  const day = iso ? +iso[3] : slash ? +slash[2] : +(named![1] || named![4]);
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

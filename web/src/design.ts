import { coachingCycle, localDate } from "../../server/src/parse/normalize";

export const avatarPalette = [
  "#E4C9A8",
  "#C9DFD0",
  "#C3D0E6",
  "#EBC3B6",
  "#D8CFE8",
  "#E9DDA9",
  "#BFDAD6",
];
export function avatarColor(code: string) {
  return avatarPalette[
    [...code].reduce((sum, char) => sum + char.charCodeAt(0), 0) %
      avatarPalette.length
  ];
}
export function cairoHeader(now: Date, firstName: string, startDay = 21) {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Africa/Cairo",
      hour: "2-digit",
      hourCycle: "h23",
    }).format(now),
  );
  const date = localDate("Africa/Cairo", now);
  const cycle = coachingCycle(date, startDay);
  const elapsed = (Date.parse(date) - Date.parse(cycle.from)) / 86400000 + 1;
  const days = (Date.parse(cycle.to) - Date.parse(cycle.from)) / 86400000 + 1;
  return {
    greeting: `Good ${hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening"}, ${firstName}.`,
    eyebrow: `${new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Cairo", weekday: "long", day: "numeric", month: "long" }).format(now)} · Cycle day ${elapsed} of ${days}`,
  };
}

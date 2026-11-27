import { coachingCycle, localDate } from "../../server/src/parse/normalize";
import { mtdMismatch, shortDate } from "../../server/src/v2/templates";
import type { SyncStatus } from "../../server/src/api/dto";
import { mtdNotPasted } from "../../server/src/api/dto";

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
const age = (stamp: string, now: number) => {
  const minutes = Math.max(0, Math.floor((now - Date.parse(stamp)) / 60000));
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 48 * 60) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / 1440)} days ago`;
};

/**
 * The freshness line shown on every page. "bad" means a sync failed and
 * "waiting" means a source is stale or has not arrived.
 */
export function freshness(status: SyncStatus, now = Date.now()) {
  const parts: string[] = [];
  let stale = false;
  const through = status.attendanceThrough;
  const attendanceOn = status.sources.some(
    (source) => source.job === "attendance" && source.enabled,
  );
  if (through) {
    const day = shortDate(through);
    parts.push(
      status.mtdSyncedOn && !status.mtdMissing
        ? `Attendance & MTD through ${day}`
        : status.mtdMissing
          ? `Attendance through ${day}`
          : `Attendance through ${day} · MTD not imported`,
    );
    const yesterday = new Date(Date.parse(status.date) - 86400000)
      .toISOString()
      .slice(0, 10);
    if (attendanceOn && through < yesterday) stale = true;
  } else {
    parts.push("Attendance not imported");
    if (attendanceOn) stale = true;
  }
  if (status.mtdMissing) {
    parts.push(mtdNotPasted);
    stale = true;
  }
  if (status.mtdMismatch?.length) {
    parts.push(mtdMismatch(status.mtdMismatch.length));
    stale = true;
  }
  if (status.sources.some((source) => source.job === "qa")) {
    const qa = status.jobs.qa?.lastSuccessAt;
    parts.push(qa ? `QA synced ${age(qa, now)}` : "QA not synced yet");
    if (!qa) stale = true;
  } else parts.push("QA not connected");
  const roster = status.jobs.roster?.lastSuccessAt;
  if (!roster) {
    parts.unshift("Awaiting first sync");
    stale = true;
  } else if (now - Date.parse(roster) > 7 * 86400000) {
    parts.unshift("Roster " + age(roster, now).replace(" ago", " old"));
    stale = true;
  }
  if (status.attendanceStale) {
    parts.unshift("Attendance paste is stale");
    stale = true;
  }
  const failed = Object.values(status.jobs).some(
    (job) => job.lastRun?.ok === false,
  );
  if (failed) parts.unshift("Last sync failed");
  if (status.running) parts.unshift(`Syncing ${status.running}`);
  return {
    tone: failed ? "bad" : stale || status.running ? "waiting" : "good",
    text: parts.join(" · "),
  };
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
    eyebrow: `${new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Cairo", weekday: "long" }).format(now)} ${shortDate(date)} · Cycle day ${elapsed} of ${days}`,
  };
}

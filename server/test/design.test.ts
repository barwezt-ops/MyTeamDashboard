import { expect, it } from "vitest";
import {
  avatarColor,
  avatarPalette,
  cairoHeader,
} from "../../web/src/design.js";
import { loadConfig } from "../src/config.js";

it("labels Cairo greetings and cycle boundaries, including leap years and DST", () => {
  const header = (stamp: string, start = 21) =>
    cairoHeader(new Date(stamp), "Alex", start);
  expect(header("2026-11-26T12:00:00Z")).toEqual({
    greeting: "Good afternoon, Alex.",
    eyebrow: "Thursday 26 November · Cycle day 6 of 30",
  });
  expect(header("2026-11-20T22:30:00Z")).toMatchObject({
    greeting: "Good morning, Alex.",
    eyebrow: "Saturday 21 November · Cycle day 1 of 30",
  });
  expect(header("2026-11-20T10:00:00Z").eyebrow).toContain(
    "Cycle day 31 of 31",
  );
  expect(header("2024-03-20T10:00:00Z").eyebrow).toContain(
    "Cycle day 29 of 29",
  );
  expect(header("2026-07-01T21:30:00Z", 1)).toEqual({
    greeting: "Good morning, Alex.",
    eyebrow: "Thursday 2 July · Cycle day 2 of 31",
  });
  expect(header("2026-12-31T21:00:00Z").greeting).toBe("Good evening, Alex.");
});
it("assigns stable avatar colors by code, independently of names", () => {
  expect(avatarColor("99001")).toBe(avatarColor("99001"));
  expect(avatarPalette).toContain(avatarColor("99002"));
  expect(avatarPalette).toContain(avatarColor(""));
});
it("defaults to the owner's team without removing covered-team model support", () => {
  expect(loadConfig().me).toMatchObject({
    alsoCover: [],
    defaultScope: "mine",
  });
});

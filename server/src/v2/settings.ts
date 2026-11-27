// Owner-entered settings and records. Thresholds ship empty except the one the
// owner has set: three or more lateness incidents in a cycle.
import { z } from "zod";
import type { Db } from "../db/db.js";
import { coachingTypes, followUpStates, measures, reasons } from "./choices.js";

const count = z.number().int().positive().nullable().default(null);
const fields = z.strictObject({
  cycleStartDay: z.number().int().min(1).max(28).default(21),
  latenessIncidents: z.number().int().positive().nullable().default(3),
  missingMinutes: count,
  missingDays: count,
  missingWindowDays: count,
  breakConsecutive: count,
  /** NCNS/AWOL days per cycle. Empty until the owner decides. */
  absentDays: count,
  qaBelow: z.number().min(0).max(100).nullable().default(null),
  noQaDays: count,
  coachingTarget: z.number().int().min(1).max(31).default(2),
  staffing: z
    .record(z.string().min(1).max(100), z.number().int().nonnegative())
    .default({}),
  reportTemplate: z.string().max(20000).default(""),
  /** Hours for automatic attendance reads; empty uses the config file. */
  attendanceHours: z
    .strictObject({
      start: z.number().int().min(0).max(23),
      end: z.number().int().min(0).max(24),
    })
    .refine(
      (hours) => hours.start !== hours.end,
      "Set different attendance start and end hours",
    )
    .nullable()
    .default(null),
  /** Saved Team table views. */
  views: z
    .array(
      z.strictObject({
        name: z.string().trim().min(1).max(40),
        columns: z.array(z.string().max(80)).max(100),
        sort: z.string().max(80),
        descending: z.boolean(),
        line: z.string().max(100),
        flagged: z.boolean(),
        compact: z.boolean(),
      }),
    )
    .max(20)
    .default([]),
});
export const settingsSchema = fields.refine(
  (s) => (s.missingDays === null) === (s.missingWindowDays === null),
  "Set both missing days and its window",
);
export type V2Settings = z.infer<typeof settingsSchema>;
/**
 * A change to some settings. Omitted fields keep their saved value, and the
 * merged result is validated by `settingsSchema`.
 */
export const settingsPatch = z.record(z.string(), z.unknown());

export function readSettings(db: Db, cycleStartDay = 21): V2Settings {
  const row = db
    .prepare("SELECT value FROM owner_settings WHERE key='v2'")
    .get() as { value: string } | undefined;
  return settingsSchema.parse(row ? JSON.parse(row.value) : { cycleStartDay });
}
export function saveSettings(db: Db, settings: V2Settings) {
  db.prepare(
    "INSERT INTO owner_settings(key,value) VALUES ('v2',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
  ).run(JSON.stringify(settings));
}

export { reasons, coachingTypes, measures, followUpStates };

const unique = (values: string[]) => new Set(values).size === values.length;
export const coachingSchema = z
  .strictObject({
    code: z.string().min(1).max(100),
    date: z.iso.date(),
    type: z.enum(coachingTypes),
    reasons: z
      .array(z.enum(reasons))
      .min(1)
      .refine(unique, "Duplicate reasons"),
    evidence: z
      .array(z.string().max(300))
      .max(100)
      .refine(unique, "Duplicate evidence"),
    whatHappened: z.string().trim().min(1).max(10000),
    whatWasSaid: z.string().max(10000),
    nextStep: z.string().trim().min(1).max(10000),
    followUpDate: z.iso.date().nullable(),
    acknowledged: z.boolean(),
    measure: z.enum(measures).default("none"),
    target: z.number().int().nonnegative().nullable().default(null),
  })
  .refine(
    (s) =>
      s.measure === "none" || (s.followUpDate !== null && s.target !== null),
    "A measurable step needs a target and follow-up date",
  )
  .refine(
    (s) => s.followUpDate === null || s.followUpDate >= s.date,
    "The follow-up date cannot be before the coaching date",
  );
export type CoachingInput = z.infer<typeof coachingSchema>;

export const privateNoteSchema = z.strictObject({
  date: z.iso.date(),
  body: z.string().trim().min(1).max(10000),
  tags: z
    .array(z.string().trim().min(1).max(40))
    .max(10)
    .refine(unique, "Duplicate tags"),
});
export type PrivateNoteInput = z.infer<typeof privateNoteSchema>;

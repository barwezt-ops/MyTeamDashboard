// Owner-entered records, plus the line history that cannot be fetched again.
import { z } from "zod";
import type { Db } from "../db/db.js";
import {
  coachingTypes,
  followUpStates,
  measures,
  settingsSchema,
} from "./settings.js";

const text = z.string().max(100000),
  id = z.number().int().positive(),
  stamp = z.iso.datetime();
const json = (check: (value: unknown) => boolean, message: string) =>
  text.refine((s) => {
    try {
      return check(JSON.parse(s));
    } catch {
      return false;
    }
  }, message);
const arrayJson = json(Array.isArray, "Invalid JSON array");
export const ownerBackupSchema = z
  .strictObject({
    coachings: z.array(
      z.strictObject({
        id,
        code: text,
        date: z.iso.date(),
        type: z.enum(coachingTypes),
        reasons: arrayJson,
        evidence: arrayJson,
        what_happened: text,
        what_was_said: text,
        next_step: text,
        acknowledged: z.union([z.literal(0), z.literal(1)]),
        measure: z.enum(measures),
        target: z.number().nonnegative().nullable(),
        created_at: stamp,
      }),
    ),
    followups: z.array(
      z.strictObject({
        id,
        coaching_id: id,
        code: text,
        date: z.iso.date(),
        state: z.enum(followUpStates),
      }),
    ),
    privateNotes: z.array(
      z.strictObject({
        id,
        code: text,
        date: z.iso.date(),
        body: text,
        tags: arrayJson,
        created_at: stamp,
        updated_at: stamp,
      }),
    ),
    dismissals: z.array(
      z.strictObject({
        id: text,
        facts: arrayJson,
        reason: text,
        dismissed_at: stamp,
      }),
    ),
    settings: z.array(
      z.strictObject({
        key: z.literal("v2"),
        value: json(
          (value) => settingsSchema.safeParse(value).success,
          "Invalid settings",
        ),
      }),
    ),
    lineHistory: z.array(
      z.strictObject({
        id,
        code: text,
        changed_at: stamp,
        changed_on: z.iso.date(),
        line: text,
        account: text,
        template: arrayJson,
      }),
    ),
  })
  .superRefine((v, ctx) => {
    for (const rows of [
      v.coachings,
      v.followups,
      v.privateNotes,
      v.dismissals,
      v.lineHistory,
    ])
      if (new Set(rows.map((r) => r.id)).size !== rows.length)
        ctx.addIssue({ code: "custom", message: "Duplicate owner records" });
    if (v.settings.length > 1)
      ctx.addIssue({ code: "custom", message: "Duplicate settings" });
    if (
      v.followups.some(
        (f) =>
          !v.coachings.some((c) => c.id === f.coaching_id && c.code === f.code),
      )
    )
      ctx.addIssue({
        code: "custom",
        message: "Follow-up coaching is missing",
      });
  });
export type OwnerBackup = z.infer<typeof ownerBackupSchema>;

// Delete order respects the follow-up foreign key. Insert order is the reverse.
const tables = [
  ["coaching_followups", "followups", "id"],
  ["coachings", "coachings", "id"],
  ["private_notes", "privateNotes", "id"],
  ["flag_dismissals", "dismissals", "id"],
  ["owner_settings", "settings", "key"],
  ["line_history", "lineHistory", "id"],
] as const;

export function ownerBackup(db: Db): OwnerBackup {
  return ownerBackupSchema.parse(
    Object.fromEntries(
      tables.map(([table, key, order]) => [
        key,
        db.prepare(`SELECT * FROM ${table} ORDER BY ${order}`).all(),
      ]),
    ),
  );
}
export function restoreOwner(db: Db, data: OwnerBackup) {
  for (const [table] of tables) db.prepare(`DELETE FROM ${table}`).run();
  for (const [table, key] of [...tables].reverse()) {
    for (const row of data[key]) {
      // Column names come from the strict schema above.
      const columns = Object.keys(row);
      db.prepare(
        `INSERT INTO ${table} (${columns.join(",")}) VALUES (${columns.map((c) => "@" + c).join(",")})`,
      ).run(row);
    }
  }
}

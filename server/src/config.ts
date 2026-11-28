import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import cron from "node-cron";
import { z } from "zod";
import { statuses } from "./api/dto.js";
import { parseDate } from "./parse/normalize.js";
import { indexOf } from "./parse/columns.js";
import { attendancePasteStatusMap } from "./parse/status.js";

export const accessModes = ["public", "google", "file"] as const;

const column = z
  .string()
  .regex(/^[A-Z]{1,3}$/, "Expected a spreadsheet column letter");
const source = z.object({
  access: z.enum(accessModes).default("public"),
  label: z.string().min(1),
  sheetId: z.string().regex(/^[A-Za-z0-9_-]*$/),
  gid: z.string().regex(/^\d*$/),
  tab: z.string(),
  mode: z.enum(["export", "gviz"]),
  headerRows: z.number().int().min(0),
  query: z.string().optional(),
});
const rosterColumn = z.string().trim().toUpperCase().pipe(column);
const rosterColumns = z.strictObject({
  hireDate: rosterColumn,
  code: rosterColumn,
  name: rosterColumn,
  account: rosterColumn,
  account2: rosterColumn,
  dtl: rosterColumn,
  tl: rosterColumn,
  stl: rosterColumn,
  title: rosterColumn,
  lastWorkingDay: rosterColumn,
});
const master = source.extend({
  headerRows: z.union([z.literal(0), z.literal(1)]),
  columns: rosterColumns.refine(
    (columns) =>
      new Set(Object.values(columns)).size === Object.keys(columns).length,
    "Roster columns must be unique",
  ),
  expectHeaders: z
    .partialRecord(rosterColumns.keyof(), z.string().trim().min(1))
    .optional(),
});
const schedule = source.extend({
  mode: z.literal("export"),
  headerRows: z.number().int().positive(),
  columns: z.object({ code: column, name: column, account: column }).strict(),
  anchor: z.object({
    column,
    date: z
      .string()
      .regex(/^\d{4}-\d\d-\d\d$/)
      .refine((value) => parseDate(value) !== null, "Invalid date"),
  }),
  stopAtHeader: z
    .string()
    .min(1)
    .refine((pattern) => {
      try {
        new RegExp(pattern);
        return true;
      } catch {
        return false;
      }
    }, "Invalid regex"),
  stopColumn: column.optional(),
});
const attendance = source.extend({
  enabled: z.boolean(),
  paste: z
    .object({
      sheetId: z.string().regex(/^[\w-]+$/),
      startHour: z.number().int().min(0).max(23).default(0),
      endHour: z.number().int().min(0).max(24).default(24),
      /** Label in the Exceeded column for an exceeded break ("Exceeded"). */
      breakExceededLabel: z.string().trim().min(1).optional(),
    })
    .refine(
      (value) => value.startHour !== value.endHour,
      "Set different attendance start and end hours",
    )
    .optional(),
  layout: z.enum(["long", "wide"]),
  long: z.object({
    columns: z
      .object({
        code: column,
        name: column.optional(),
        date: column,
        status: column,
        missing: column.optional(),
      })
      .strict(),
  }),
  wide: z.object({
    keyColumn: column,
    dtlColumn: column.default("B"),
    keyType: z.enum(["name", "code"]),
    firstDateColumn: column,
    lastDateColumn: column.optional(),
    dateHeaderRow: z.number().int().positive(),
  }),
});
export const configSchema = z
  .object({
    me: z.object({
      rosterName: z.string().trim().min(1),
      firstName: z.string().trim().min(1).max(80).optional(),
      alsoCover: z.array(z.string().trim().min(1)),
      defaultScope: z.enum(["mine", "covered", "all"]),
    }),
    dateOrder: z.enum(["MDY", "DMY"]).default("MDY"),
    timezone: z.string().refine((zone) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: zone });
        return true;
      } catch {
        return false;
      }
    }, "Invalid timezone"),
    jobs: z.object({
      daily: z.string().refine(cron.validate, "Invalid cron expression"),
      weekly: z.string().refine(cron.validate, "Invalid cron expression"),
    }),
    coachingCycleStartDay: z.number().int().min(1).max(28).default(21),
    syncWindow: z.object({
      pastDays: z.number().int().nonnegative(),
      futureDays: z.number().int().nonnegative(),
    }),
    sources: z.object({
      master,
      schedule,
      attendance,
      lineQueue: source
        .extend({
          access: z.literal("public").default("public"),
          mode: z.literal("export"),
          enabled: z.boolean().default(false),
          /** Header names, when the tab labels them differently. */
          headers: z
            .strictObject({
              code: z.string().min(1),
              line: z.string().min(1),
              account: z.string().min(1),
            })
            .optional(),
        })
        .refine(
          (s) => !s.enabled || (!!s.sheetId && !!s.gid),
          "Queue source needs a sheet and tab ID before enabling",
        )
        .optional(),
      qa: source
        .extend({
          access: z.enum(["public", "google"]).default("public"),
          mode: z.literal("export"),
          enabled: z.boolean().default(false),
          mappingApproved: z.boolean().default(false),
          scoreFormat: z.enum(["percent", "fraction"]).optional(),
          columns: z
            .strictObject({
              code: z.string().min(1),
              date: z.string().min(1),
              score: z.string().min(1),
              form: z.string().min(1).optional(),
              autofail: z.string().min(1).optional(),
              account: z.string().min(1).optional(),
            })
            .optional(),
        })
        .refine(
          (s) =>
            !s.enabled ||
            (s.mappingApproved && !!s.columns && !!s.sheetId && !!s.gid),
          "QA requires approved mapping and source IDs before enabling",
        )
        .optional(),
    }),
    statusMap: z.record(z.string(), z.enum(statuses)),
    thresholds: z.partialRecord(
      z.enum(statuses),
      z.object({
        count: z.number().int().positive(),
        days: z.number().int().positive(),
      }),
    ),
  })
  .superRefine((config, ctx) => {
    for (const key of ["master", "schedule", "attendance"] as const) {
      const item = config.sources[key];
      if (
        key === "attendance" &&
        config.sources.attendance.paste &&
        item.access === "google"
      )
        continue;
      if (item.access === "file") continue;
      const tabField =
        item.access === "google" || item.mode === "gviz" ? "tab" : "gid";
      if (item.sheetId && !item[tabField].trim()) {
        ctx.addIssue({
          code: "custom",
          path: ["sources", key, tabField],
          message: "Required when a sheet is configured",
        });
      }
      if (item.sheetId && item.access === "google" && !item.gid)
        ctx.addIssue({
          code: "custom",
          path: ["sources", key, "gid"],
          message: "Set the GID for the configured Google tab",
        });
    }
    const { schedule, attendance } = config.sources;
    if (
      attendance.paste &&
      attendance.access === "google" &&
      (attendance.layout !== "long" || attendance.headerRows !== 1)
    )
      ctx.addIssue({
        code: "custom",
        path: ["sources", "attendance"],
        message: "The Attendance paste uses long layout with one header row",
      });
    if (
      schedule.access === "google" &&
      (!schedule.stopColumn ||
        indexOf(schedule.stopColumn) <= indexOf(schedule.anchor.column))
    )
      ctx.addIssue({
        code: "custom",
        path: ["sources", "schedule", "stopColumn"],
        message:
          "Set the stop header column after the anchor for Google access",
      });
    if (
      attendance.access === "google" &&
      attendance.layout === "wide" &&
      (!attendance.wide.lastDateColumn ||
        indexOf(attendance.wide.lastDateColumn) <
          indexOf(attendance.wide.firstDateColumn))
    )
      ctx.addIssue({
        code: "custom",
        path: ["sources", "attendance", "wide", "lastDateColumn"],
        message: "Set the last date column for Google access",
      });
  });
export type Config = z.infer<typeof configSchema>;
export type SourceKey = "master" | "schedule" | "attendance";
export function loadConfig(
  path: string | undefined = undefined,
  mode: "fixture" | "live" = "fixture",
  checkLink = false,
): Config {
  const localFile = resolve("config/sources.local.json");
  const file =
    path ??
    (mode === "live" || checkLink
      ? process.env.DASHBOARD_CONFIG_FILE?.trim() ||
        (existsSync(localFile) ? localFile : undefined)
      : undefined) ??
    resolve("config/sources.json");
  try {
    const raw =
      mode === "live" &&
      !process.env.DASHBOARD_CONFIG_FILE?.trim() &&
      process.env.DASHBOARD_SOURCE_CONFIG
        ? JSON.parse(process.env.DASHBOARD_SOURCE_CONFIG)
        : JSON.parse(readFileSync(file, "utf8"));
    const config = configSchema.parse(raw);
    if (
      config.sources.attendance.paste &&
      config.sources.attendance.access === "google"
    )
      config.statusMap = { ...attendancePasteStatusMap, ...config.statusMap };
    if (mode === "live" && !checkLink) {
      for (const key of ["master", "schedule", "attendance"] as const) {
        if (key === "attendance" && !config.sources.attendance.enabled)
          continue;
        if (
          config.sources[key].access !== "file" &&
          !(
            key === "attendance" &&
            config.sources.attendance.access === "google" &&
            config.sources.attendance.paste
          ) &&
          !config.sources[key].sheetId
        )
          throw new Error(
            "sources." + key + ".sheetId is required in live mode",
          );
      }
    }
    return config;
  } catch (error) {
    const details =
      error instanceof z.ZodError
        ? error.issues
            .map((issue) => issue.path.join(".") + ": " + issue.message)
            .join("\n")
        : error instanceof Error
          ? error.message
          : String(error);
    throw new Error("Invalid source config " + file + "\n" + details);
  }
}

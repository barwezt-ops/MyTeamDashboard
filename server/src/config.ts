import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import cron from "node-cron";
import { z } from "zod";
import { statuses } from "./api/dto.js";
import { parseDate } from "./parse/normalize.js";

const column = z
  .string()
  .regex(/^[A-Z]{1,3}$/, "Expected a spreadsheet column letter");
const source = z.object({
  label: z.string().min(1),
  sheetId: z.string().regex(/^[A-Za-z0-9_-]*$/),
  gid: z.string().regex(/^\d*$/),
  tab: z.string(),
  mode: z.enum(["export", "gviz"]),
  headerRows: z.number().int().min(0),
  query: z.string().optional(),
});
const rosterColumn = z.enum(["A", "B", "C", "D", "E", "G", "H", "I", "K", "M"]);
const master = source.extend({
  headerRows: z.union([z.literal(0), z.literal(1)]),
  columns: z
    .object({
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
    })
    .strict()
    .refine(
      (columns) =>
        new Set(Object.values(columns)).size === Object.keys(columns).length,
      "Roster columns must be unique",
    ),
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
});
const attendance = source.extend({
  enabled: z.boolean(),
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
    dateHeaderRow: z.number().int().positive(),
  }),
});
export const configSchema = z
  .object({
    me: z.object({
      rosterName: z.string().trim().min(1),
      alsoCover: z.array(z.string().trim().min(1)),
      defaultScope: z.enum(["mine", "covered", "all"]),
    }),
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
    syncWindow: z.object({
      pastDays: z.number().int().nonnegative(),
      futureDays: z.number().int().nonnegative(),
    }),
    sources: z.object({ master, schedule, attendance }),
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
      if (item.sheetId && !(item.mode === "export" ? item.gid : item.tab)) {
        ctx.addIssue({
          code: "custom",
          path: ["sources", key, item.mode === "export" ? "gid" : "tab"],
          message: "Required when a sheet is configured",
        });
      }
    }
  });
export type Config = z.infer<typeof configSchema>;
export type SourceKey = keyof Config["sources"];
export function loadConfig(
  path = resolve("config/sources.json"),
  mode: "fixture" | "live" = "fixture",
): Config {
  try {
    const file =
      mode === "live" && existsSync(resolve("config/sources.local.json"))
        ? resolve("config/sources.local.json")
        : path;
    const raw =
      mode === "live" && process.env.DASHBOARD_SOURCE_CONFIG
        ? JSON.parse(process.env.DASHBOARD_SOURCE_CONFIG)
        : JSON.parse(readFileSync(file, "utf8"));
    const config = configSchema.parse(raw);
    if (mode === "live") {
      for (const key of ["master", "schedule", "attendance"] as const) {
        if (key === "attendance" && !config.sources.attendance.enabled)
          continue;
        if (!config.sources[key].sheetId)
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
    throw new Error("Invalid source config " + path + "\n" + details);
  }
}

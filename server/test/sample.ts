import { readFileSync } from "node:fs";
import { decodeCsv } from "../src/fetch/fetchCsv.js";
import { loadConfig } from "../src/config.js";
import { parseMaster } from "../src/parse/master.js";
export const today = "2026-11-21";
export const window = { from: "2026-10-17", to: "2026-12-05" };
export const sample = (name: string) =>
  decodeCsv(readFileSync("fixtures/" + name + ".sample.csv", "utf8"));
export const sampleMaster = () =>
  parseMaster(sample("master"), loadConfig(), today);

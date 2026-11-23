import cron from "node-cron";
import type { Config } from "../config.js";
import type { SyncService } from "./service.js";
export function startCron(config: Config, sync: SyncService) {
  const options = { timezone: config.timezone };
  return [
    cron.schedule(
      config.jobs.weekly,
      () => {
        void sync.start("roster");
      },
      options,
    ),
    cron.schedule(
      config.jobs.daily,
      () => {
        void sync.start("daily");
      },
      options,
    ),
  ];
}

import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["server/test/**/*.test.ts"],
    coverage: {
      include: ["server/src/parse/**", "server/src/rules/**"],
      thresholds: { lines: 90 },
    },
  },
});

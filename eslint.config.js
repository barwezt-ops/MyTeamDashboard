import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
export default [
  {
    ignores: [
      "**/dist/**",
      "server/dist.test/**",
      ".runtime-restore/**",
      "coverage/**",
      "test-results/**",
      "playwright-report/**",
      ".windows-runtime/**",
    ],
  },
  ...tseslint.configs.recommended,
  prettier,
];

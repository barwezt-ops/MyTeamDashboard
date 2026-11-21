import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
export default [
  {
    ignores: [
      "**/dist/**",
      "coverage/**",
      "test-results/**",
      "playwright-report/**",
    ],
  },
  ...tseslint.configs.recommended,
  prettier,
];

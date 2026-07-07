import js from "@eslint/js";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist", "uploads", "node_modules"],
  },
  {
    extends: [js.configs.recommended],
    files: ["*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.node,
      },
    },
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["src/**/*.ts"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.node,
      },
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Type-checked rules added individually (not the full
      // `recommendedTypeChecked` preset) — that preset also turns on the
      // `no-unsafe-*` family, which would require eliminating `any` from
      // Mongoose documents and JSON payloads across the whole codebase, a
      // much larger job than "catch a missed await on a Fastify handler."
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
    },
  },
  {
    // node:test's `test(name, async () => {...})` returns a promise the
    // runner tracks internally — it's never meant to be awaited at module
    // scope, so `no-floating-promises` false-positives on every test file.
    files: ["src/**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-floating-promises": "off",
    },
  },
  eslintPluginPrettier,
);

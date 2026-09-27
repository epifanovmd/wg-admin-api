import eslint from "@eslint/js";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["build", "node_modules", "src/routing/routes.ts", "src/migrations/**"],
  },
  {
    extends: [eslint.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.ts"],
    plugins: {
      "simple-import-sort": simpleImportSort,
    },
    rules: {
      "simple-import-sort/imports": "error",
      "simple-import-sort/exports": "error",

      "no-undef": "off",
      "no-unused-vars": "off",
      "no-redeclare": "off",

      // typescript-eslint: шаблон осознанно использует any в инфраструктуре
      // (декораторы, DI, адаптеры библиотек).
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-unsafe-function-type": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-namespace": "off",

      // Логика и читаемость (форматирование — prettier)
      "func-style": ["error", "expression"],
      "prefer-arrow-callback": "error",
      "no-console": "error",
      "no-bitwise": "error",
      "no-plusplus": "error",
      "no-lonely-if": "error",
      "no-multi-assign": "error",
      "no-unneeded-ternary": "error",
      "no-array-constructor": "error",
      "operator-assignment": ["error", "always"],
      "padding-line-between-statements": [
        "error",
        { blankLine: "always", prev: ["const", "let", "var"], next: "*" },
        { blankLine: "always", prev: "*", next: "return" },
        {
          blankLine: "any",
          prev: ["const", "let", "var"],
          next: ["const", "let", "var"],
        },
      ],
    },
  },
  {
    // chai: `expect(x).to.be.true` — выражение-утверждение, а не забытый код.
    files: ["**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-unused-expressions": "off",
    },
  },
);

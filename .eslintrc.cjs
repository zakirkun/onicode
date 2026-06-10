/**
 * ESLint configuration for OniCode.
 *
 * Uses the legacy `.eslintrc.cjs` format intentionally to maximize plugin
 * compatibility (typescript-eslint v8, eslint-plugin-react v7). Migration to
 * the flat config (`eslint.config.js`) is tracked for a future release once
 * the wider plugin ecosystem stabilizes.
 */
module.exports = {
  root: true,
  env: {
    node: true,
    es2022: true,
  },
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
    project: "./tsconfig.json",
    ecmaFeatures: { jsx: true },
  },
  plugins: ["@typescript-eslint", "react", "react-hooks"],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:@typescript-eslint/recommended-requiring-type-checking",
    "plugin:react/recommended",
    "plugin:react-hooks/recommended",
    "prettier",
  ],
  settings: {
    react: { version: "18" },
  },
  rules: {
    // React 17+ JSX transform makes the React import unnecessary.
    "react/react-in-jsx-scope": "off",
    "react/prop-types": "off",

    // Encourage explicit types at module boundaries; allow inference inside functions.
    "@typescript-eslint/explicit-module-boundary-types": "warn",

    // Unused variables: allow leading underscore as an explicit "intentionally unused" marker.
    "@typescript-eslint/no-unused-vars": [
      "error",
      { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
    ],

    // `any` is allowed only with explicit justification — keeps escape hatches deliberate.
    "@typescript-eslint/no-explicit-any": "warn",

    // Prefer explicit `import type` for type-only imports to keep runtime bundles lean.
    "@typescript-eslint/consistent-type-imports": [
      "error",
      { prefer: "type-imports", fixStyle: "separate-type-imports" },
    ],

    // Avoid `console.log` in committed code; structured logger is the supported channel.
    "no-console": ["warn", { allow: ["warn", "error"] }],
  },
  overrides: [
    {
      files: ["**/*.test.ts", "**/*.test.tsx", "tests/**/*.{ts,tsx}"],
      rules: {
        "@typescript-eslint/no-explicit-any": "off",
        "@typescript-eslint/no-non-null-assertion": "off",
      },
    },
  ],
  ignorePatterns: ["dist", "node_modules", "coverage", "*.config.ts", "*.config.js", "*.config.cjs"],
};

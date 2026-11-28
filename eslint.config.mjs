import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

import designTokens from "./scripts/eslint-design-tokens.mjs";

const config = [
  {
    // `next lint` only looked at a few source directories; `eslint .` walks everything, so
    // keep out the generated output that .gitignore already excludes (the Playwright report
    // is minified JS). eslint-config-next ignores .next, out and build itself.
    ignores: ["playwright-report/**", "test-results/**", "blob-report/**", ".vercel/**"],
  },
  ...coreWebVitals,
  ...typescript,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // docs/design-system.md, enforced: radii and colours from the theme in src/app/globals.css,
    // no arbitrary font sizes or literal colours. Tests assert on what a user sees, not classes.
    files: ["src/**/*.{ts,tsx}", "mdx-components.tsx"],
    ignores: ["**/__tests__/**"],
    plugins: { design: designTokens },
    rules: { "design/tokens": "error" },
  },
  {
    // Playwright fixtures take a callback named `use`, which the hooks rule
    // reads as React's `use()` hook.
    files: ["e2e/**"],
    rules: { "react-hooks/rules-of-hooks": "off" },
  },
];

export default config;

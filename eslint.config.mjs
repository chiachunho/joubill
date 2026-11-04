import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

const config = [
  ...coreWebVitals,
  ...typescript,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // eslint-config-next 16 ships eslint-plugin-react-hooks 7, whose React
      // Compiler rules flag patterns this codebase uses deliberately (a ref
      // written during render as "latest value", state reset in an effect when
      // a dialog opens). We don't use the compiler, so these are style
      // suggestions, not bugs. Revisit if the compiler is ever adopted.
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/refs": "off",
      "react-hooks/purity": "off",
      "react-hooks/preserve-manual-memoization": "off",
      "react-hooks/incompatible-library": "off",
    },
  },
  {
    // Playwright fixtures take a callback named `use`, which the hooks rule
    // reads as React's `use()` hook.
    files: ["e2e/**"],
    rules: { "react-hooks/rules-of-hooks": "off" },
  },
];

export default config;

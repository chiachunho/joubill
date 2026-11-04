import { configDefaults, defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

const env = {
  // Dummy env so modules that import @/db (which calls serverEnv() at load)
  // don't throw. The neon-http client is lazy and never connects in unit tests.
  DATABASE_URL: "postgres://test:test@localhost:5432/test",
  TELEGRAM_BOT_TOKEN: "123456:test-bot-token",
  TELEGRAM_WEBHOOK_SECRET: "test-secret",
  TELEGRAM_MINI_APP_NAME: "splitbill_test",
  TELEGRAM_STORAGE_CHAT_ID: "-1001234567890",
  NEXT_PUBLIC_MINI_APP_URL: "https://example.com/mini",
};

// Two projects instead of one config with a glob → environment map: component
// tests render into a DOM (jsdom); lib tests stay on node so the suite doesn't
// pay jsdom's startup cost on every file.
const shared = {
  plugins: [tsconfigPaths()],
  // tsconfig sets "jsx": "preserve" for Next's compiler; tests need the React
  // 17+ automatic runtime, or every .tsx file fails with "React is not defined".
  esbuild: { jsx: "automatic" as const },
};

export default defineConfig({
  test: {
    projects: [
      {
        ...shared,
        test: {
          name: "node",
          environment: "node",
          include: ["src/**/*.test.ts", "src/**/*.test.tsx", "scripts/**/*.test.mjs"],
          exclude: [...configDefaults.exclude, "src/components/**/*.test.tsx"],
          env,
        },
      },
      {
        ...shared,
        test: {
          name: "jsdom",
          environment: "jsdom",
          include: ["src/components/**/*.test.tsx"],
          env,
        },
      },
    ],
  },
});

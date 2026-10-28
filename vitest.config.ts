import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  // tsconfig sets "jsx": "preserve" for Next's compiler; tests need the React
  // 17+ automatic runtime, or every .tsx file fails with "React is not defined".
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    // Component tests render into a DOM; lib tests stay on node so the suite
    // doesn't pay jsdom's startup cost on every file.
    environmentMatchGlobs: [["src/components/**/*.test.tsx", "jsdom"]],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "scripts/**/*.test.mjs"],
    // Dummy env so modules that import @/db (which calls serverEnv() at load)
    // don't throw. The neon-http client is lazy and never connects in unit tests.
    env: {
      DATABASE_URL: "postgres://test:test@localhost:5432/test",
      TELEGRAM_BOT_TOKEN: "123456:test-bot-token",
      TELEGRAM_WEBHOOK_SECRET: "test-secret",
      TELEGRAM_MINI_APP_NAME: "splitbill_test",
      TELEGRAM_STORAGE_CHAT_ID: "-1001234567890",
      NEXT_PUBLIC_MINI_APP_URL: "https://example.com/mini",
    },
  },
});

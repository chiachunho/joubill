import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Dummy env so modules that import @/db (which calls serverEnv() at load)
    // don't throw. The neon-http client is lazy and never connects in unit tests.
    env: {
      DATABASE_URL: "postgres://test:test@localhost:5432/test",
      TELEGRAM_BOT_TOKEN: "123456:test-bot-token",
      TELEGRAM_WEBHOOK_SECRET: "test-secret",
      TELEGRAM_MINI_APP_NAME: "splitbill_test",
      NEXT_PUBLIC_MINI_APP_URL: "https://example.com/mini",
    },
  },
});

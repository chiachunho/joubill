import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// 跟 Next.js 一致：先讀 .env.local，再讀 .env
config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

// `generate` 不需要連 DB；`push` / `studio` 需要。
// 缺 URL 時讓 drizzle-kit 自己在需要時報錯，這裡只提示。
if (!process.env.DATABASE_URL) {
  console.warn("[drizzle.config] DATABASE_URL not set — `push` / `studio` will fail.");
}

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  strict: true,
  verbose: true,
});

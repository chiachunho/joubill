import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Match Next.js order: .env.local takes precedence over .env.
config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

// `generate` works offline; `push` / `studio` need a live URL.
// Don't throw here — let drizzle-kit fail with its own message when the URL is required.
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

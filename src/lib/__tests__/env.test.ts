import { afterEach, describe, expect, it, vi } from "vitest";

const VALID = {
  TELEGRAM_BOT_TOKEN: "123:abc",
  TELEGRAM_WEBHOOK_SECRET: "secret",
  TELEGRAM_MINI_APP_NAME: "splitbill",
  TELEGRAM_STORAGE_CHAT_ID: "-1001234567890",
  DATABASE_URL: "postgres://user:pw@ep-cool-123.ap-southeast-1.aws.neon.tech/db?sslmode=require",
};

async function loadEnv(overrides: Record<string, string>) {
  vi.resetModules();
  for (const [k, v] of Object.entries({ ...VALID, ...overrides })) {
    vi.stubEnv(k, v);
  }
  return import("../env");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("serverEnv", () => {
  it("accepts a Neon connection string and trims secrets", async () => {
    const { serverEnv } = await loadEnv({ TELEGRAM_BOT_TOKEN: "  123:abc  " });
    const env = serverEnv();
    expect(env.TELEGRAM_BOT_TOKEN).toBe("123:abc");
    expect(env.DATABASE_URL).toBe(VALID.DATABASE_URL);
  });

  it("accepts a local postgres URL", async () => {
    const { serverEnv } = await loadEnv({
      DATABASE_URL: "postgres://test:test@localhost:5432/test",
    });
    expect(serverEnv().DATABASE_URL).toContain("localhost");
  });

  it("names the offending variable when one is invalid", async () => {
    const { serverEnv } = await loadEnv({ DATABASE_URL: "not a url" });
    expect(() => serverEnv()).toThrow(/Invalid server env: DATABASE_URL:/);
  });

  it("rejects an empty required variable", async () => {
    const { serverEnv } = await loadEnv({ TELEGRAM_WEBHOOK_SECRET: "   " });
    expect(() => serverEnv()).toThrow(/TELEGRAM_WEBHOOK_SECRET/);
  });
});

describe("clientEnv", () => {
  it("parses a valid mini app URL", async () => {
    const { clientEnv } = await loadEnv({
      NEXT_PUBLIC_MINI_APP_URL: "https://splitbill.example/mini",
    });
    expect(clientEnv.NEXT_PUBLIC_MINI_APP_URL).toBe("https://splitbill.example/mini");
  });

  it("throws at import when the URL is malformed", async () => {
    await expect(loadEnv({ NEXT_PUBLIC_MINI_APP_URL: "nope" })).rejects.toThrow();
  });
});

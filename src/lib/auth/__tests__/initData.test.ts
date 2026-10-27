import crypto from "node:crypto";
import { describe, expect, it } from "vitest";

import { verifyInitData } from "../initData";

const BOT_TOKEN = "123456:test-bot-token";

/**
 * Build a signed initData string the same way Telegram does, so we can verify
 * the round trip. `extra` lets a test inject fields like `signature` that must
 * still participate in the HMAC.
 */
function signInitData(params: Record<string, string>, botToken = BOT_TOKEN): string {
  const dataCheckString = Object.entries(params)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const secretKey = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const hash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  const qs = new URLSearchParams(params);
  qs.set("hash", hash);
  return qs.toString();
}

function freshParams(overrides: Record<string, string> = {}) {
  return {
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: "AAHtest",
    user: JSON.stringify({ id: 777, first_name: "Jeffery", username: "jefferyho_cc" }),
    ...overrides,
  };
}

describe("verifyInitData", () => {
  it("verifies a freshly signed payload and returns the parsed user", () => {
    const initData = signInitData(freshParams());
    const result = verifyInitData(initData, BOT_TOKEN);
    expect(result.user.id).toBe(777);
    expect(result.user.username).toBe("jefferyho_cc");
  });

  it("exposes start_param", () => {
    const initData = signInitData(freshParams({ start_param: "group_-100" }));
    const result = verifyInitData(initData, BOT_TOKEN);
    expect(result.startParam).toBe("group_-100");
  });

  it("keeps the Ed25519 `signature` field inside the HMAC (Bot API 9.0+)", () => {
    // signature participates in the data-check-string; verify must NOT strip it.
    const initData = signInitData(freshParams({ signature: "abc_ed25519_sig" }));
    expect(() => verifyInitData(initData, BOT_TOKEN)).not.toThrow();
  });

  it("rejects a tampered hash", () => {
    const initData = signInitData(freshParams()).replace(/hash=[0-9a-f]+/, "hash=deadbeef");
    expect(() => verifyInitData(initData, BOT_TOKEN)).toThrow(/hash mismatch/);
  });

  it("rejects a payload signed with a different token", () => {
    const initData = signInitData(freshParams(), "999:other-token");
    expect(() => verifyInitData(initData, BOT_TOKEN)).toThrow(/hash mismatch/);
  });

  it("rejects when hash is missing", () => {
    const params = freshParams();
    const qs = new URLSearchParams(params).toString();
    expect(() => verifyInitData(qs, BOT_TOKEN)).toThrow(/missing hash/);
  });

  it("rejects stale initData beyond the max age", () => {
    const old = String(Math.floor(Date.now() / 1000) - 25 * 60 * 60);
    const initData = signInitData(freshParams({ auth_date: old }));
    expect(() => verifyInitData(initData, BOT_TOKEN)).toThrow(/too old/);
  });

  it("rejects a payload with no user field", () => {
    const params = { auth_date: String(Math.floor(Date.now() / 1000)) };
    const initData = signInitData(params);
    expect(() => verifyInitData(initData, BOT_TOKEN)).toThrow(/missing user/);
  });
});

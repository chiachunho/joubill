import { describe, expect, it } from "vitest";

import {
  INVITE_ALPHABET,
  INVITE_NOT_FOUND,
  decodeInviteParam,
  INVITE_CODE_LENGTH,
  formatInviteCode,
  generateInviteCode,
  inviteLink,
  normalizeInviteCode,
  parseInviteCode,
} from "../invite";

describe("generateInviteCode", () => {
  it("makes 10 characters from the Crockford alphabet", () => {
    for (let i = 0; i < 200; i++) {
      const code = generateInviteCode();
      expect(code).toHaveLength(INVITE_CODE_LENGTH);
      for (const ch of code) expect(INVITE_ALPHABET).toContain(ch);
    }
  });

  it("does not repeat", () => {
    const seen = new Set(Array.from({ length: 500 }, generateInviteCode));
    expect(seen.size).toBe(500);
  });
});

describe("format / normalize", () => {
  it("round-trips a generated code", () => {
    const code = generateInviteCode();
    expect(normalizeInviteCode(formatInviteCode(code))).toBe(code);
  });

  it("groups as 5-5", () => {
    expect(formatInviteCode("K7M2QX9PAB")).toBe("K7M2Q-X9PAB");
  });

  it("ignores case, dashes and spaces", () => {
    expect(normalizeInviteCode(" k7m2q x9pab ")).toBe("K7M2QX9PAB");
  });

  it("folds I/L to 1 and O to 0", () => {
    expect(normalizeInviteCode("O1ILK7M2QX")).toBe("0111K7M2QX");
  });

  it("rejects wrong length and foreign characters", () => {
    expect(normalizeInviteCode("K7M2Q")).toBeNull();
    expect(normalizeInviteCode("K7M2QX9PAU")).toBeNull();
    expect(normalizeInviteCode("")).toBeNull();
  });
});

describe("inviteLink / parseInviteCode", () => {
  it("round-trips through the link", () => {
    const code = generateInviteCode();
    expect(parseInviteCode(inviteLink("https://x.example", code))).toBe(code);
  });

  it("asks LINE to open the link in an external browser", () => {
    expect(inviteLink("https://x.example", "K7M2QX9PAB")).toContain("openExternalBrowser=1");
  });

  it("accepts a link with a formatted code, query and hash", () => {
    expect(parseInviteCode("https://x.example/join/K7M2Q-X9PAB?a=1#b")).toBe("K7M2QX9PAB");
  });

  it("accepts a bare code", () => {
    expect(parseInviteCode("K7M2Q-X9PAB")).toBe("K7M2QX9PAB");
  });
});

describe("malformed input", () => {
  it.each(["%", "%zz", "%E0%A4%A"])("decodeInviteParam answers null for %s", (bad) => {
    expect(decodeInviteParam(bad)).toBeNull();
  });

  it("decodes an ordinary parameter", () => {
    expect(decodeInviteParam("K7M2Q-X9PAB")).toBe("K7M2Q-X9PAB");
    expect(decodeInviteParam("K7M2Q%2DX9PAB")).toBe("K7M2Q-X9PAB");
  });

  it("parseInviteCode does not throw on a broken link", () => {
    expect(parseInviteCode("https://x.example/join/%zz")).toBeNull();
    expect(parseInviteCode("https://x.example/join/%")).toBeNull();
  });

  it("has one 404 answer", () => {
    expect(INVITE_NOT_FOUND).toEqual({ status: 404, error: "邀請碼無效或已失效" });
  });
});

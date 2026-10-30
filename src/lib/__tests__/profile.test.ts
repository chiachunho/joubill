import { describe, expect, it } from "vitest";

import {
  avatarOptions,
  DISPLAY_NAME_MAX,
  displayName,
  identityProfile,
  normaliseDisplayName,
  pickAvatar,
} from "@/lib/profile";

const base = { displayName: null, firstName: "Chia-Chun", lastName: "Ho", username: "cc" };

describe("displayName", () => {
  it("prefers the chosen name", () => {
    expect(displayName({ ...base, displayName: "嘉駿" })).toBe("嘉駿");
  });

  it("falls back to the provider's first and last name", () => {
    expect(displayName(base)).toBe("Chia-Chun Ho");
  });

  it("falls back to @username, then to nothing", () => {
    expect(displayName({ ...base, firstName: null, lastName: null })).toBe("@cc");
    expect(displayName({ displayName: null, firstName: null, username: null })).toBe("");
  });

  it("reads a snapshot written before the column existed (no key at all) as unset", () => {
    const old = { firstName: "Amy", lastName: null, username: null } as unknown as Parameters<
      typeof displayName
    >[0];
    expect(displayName(old)).toBe("Amy");
  });

  it("ignores a blank chosen name", () => {
    expect(displayName({ ...base, displayName: "  " })).toBe("Chia-Chun Ho");
  });
});

describe("normaliseDisplayName", () => {
  it("trims and collapses whitespace", () => {
    expect(normaliseDisplayName("  阿明   大俠 ")).toEqual({ ok: true, value: "阿明 大俠" });
  });

  it("treats empty and null as going back to the provider's name", () => {
    expect(normaliseDisplayName("")).toEqual({ ok: true, value: null });
    expect(normaliseDisplayName(null)).toEqual({ ok: true, value: null });
  });

  it("refuses whitespace-only input rather than silently clearing", () => {
    expect(normaliseDisplayName("   ").ok).toBe(false);
  });

  it("counts characters the way a person does", () => {
    expect(normaliseDisplayName("字".repeat(DISPLAY_NAME_MAX)).ok).toBe(true);
    expect(normaliseDisplayName("字".repeat(DISPLAY_NAME_MAX + 1)).ok).toBe(false);
    // A family emoji is several code points but one character.
    expect(normaliseDisplayName("👨‍👩‍👧".repeat(DISPLAY_NAME_MAX)).ok).toBe(true);
  });

  it("refuses control and text-direction characters", () => {
    expect(normaliseDisplayName("A\nB").ok).toBe(false);
    expect(normaliseDisplayName("A‮B").ok).toBe(false);
    expect(normaliseDisplayName("A؜B").ok).toBe(false);
  });

  it("refuses a name made invisible by zero-width characters", () => {
    expect(normaliseDisplayName("​").ok).toBe(false);
    expect(normaliseDisplayName("﻿").ok).toBe(false);
  });

  it("trims a pasted trailing newline instead of refusing it", () => {
    expect(normaliseDisplayName("Amy\n")).toEqual({ ok: true, value: "Amy" });
  });
});

describe("pickAvatar", () => {
  const identities = [
    { provider: "google", pictureUrl: "g.jpg" },
    { provider: "line", pictureUrl: "l.jpg" },
    { provider: "github", pictureUrl: null },
  ];
  const input = { source: null, telegramPhoto: "t.jpg", identities, legacyAvatarUrl: "old.jpg" };

  it("is Telegram first when automatic", () => {
    expect(pickAvatar(input)).toBe("t.jpg");
  });

  it("is the next login with a picture when Telegram has none", () => {
    expect(pickAvatar({ ...input, telegramPhoto: null })).toBe("l.jpg");
  });

  it("uses the chosen source", () => {
    expect(pickAvatar({ ...input, source: "google" })).toBe("g.jpg");
  });

  it("falls back to automatic when the chosen login was unlinked or has no picture", () => {
    expect(pickAvatar({ ...input, source: "google", identities: identities.slice(1) })).toBe(
      "t.jpg",
    );
    expect(pickAvatar({ ...input, source: "github" })).toBe("t.jpg");
  });

  it("uses the stored avatar_url when no login has a picture yet", () => {
    expect(pickAvatar({ ...input, telegramPhoto: null, identities: [] })).toBe("old.jpg");
    expect(
      pickAvatar({ ...input, telegramPhoto: null, identities: [], legacyAvatarUrl: null }),
    ).toBeNull();
  });

  it("lists only the logins that have a picture, Telegram first", () => {
    expect(avatarOptions(input).map((o) => o.source)).toEqual(["telegram", "line", "google"]);
  });
});

describe("identityProfile", () => {
  it("reads each provider's own claims", () => {
    expect(identityProfile("google", { name: "C H", picture: "g" })).toEqual({
      name: "C H",
      pictureUrl: "g",
    });
    expect(identityProfile("github", { name: null, login: "cc", avatar_url: "gh" })).toEqual({
      name: "cc",
      pictureUrl: "gh",
    });
    expect(identityProfile("telegram", { preferred_username: "cc", picture: "t" })).toEqual({
      name: "cc",
      pictureUrl: "t",
    });
  });

  it("reads missing or odd fields as null", () => {
    expect(identityProfile("line", { name: 3 })).toEqual({ name: null, pictureUrl: null });
    expect(identityProfile("line", undefined)).toEqual({ name: null, pictureUrl: null });
  });
});

import { describe, expect, it } from "vitest";

import { parseCookie } from "@/lib/auth";
import { pathPhotoUrl, receiptPhotoUrl, signPhoto, verifyPhotoSig } from "@/lib/tg-photo-sign";

describe("tg-photo signatures", () => {
  it("accepts the signature it minted", () => {
    expect(verifyPhotoSig({ fileId: "abc" }, signPhoto({ fileId: "abc" }))).toBe(true);
    expect(
      verifyPhotoSig({ path: "photos/file_1.jpg" }, signPhoto({ path: "photos/file_1.jpg" })),
    ).toBe(true);
  });

  it("rejects a missing, wrong or cross-kind signature", () => {
    expect(verifyPhotoSig({ fileId: "abc" }, null)).toBe(false);
    expect(verifyPhotoSig({ fileId: "abc" }, "nope")).toBe(false);
    expect(verifyPhotoSig({ fileId: "abc" }, signPhoto({ fileId: "abd" }))).toBe(false);
    // A file id and a path with the same text must not share a signature.
    expect(verifyPhotoSig({ path: "abc" }, signPhoto({ fileId: "abc" }))).toBe(false);
  });

  it("builds URLs that carry the signature", () => {
    const url = new URL(receiptPhotoUrl("abc"), "http://x");
    expect(url.searchParams.get("fileId")).toBe("abc");
    expect(verifyPhotoSig({ fileId: "abc" }, url.searchParams.get("sig"))).toBe(true);
    const p = new URL(pathPhotoUrl("photos/file_1.jpg"), "http://x");
    expect(verifyPhotoSig({ path: "photos/file_1.jpg" }, p.searchParams.get("sig"))).toBe(true);
  });
});

describe("parseCookie", () => {
  it("reads a value and survives a malformed escape", () => {
    expect(parseCookie("a=1; session=tok", "session")).toBe("tok");
    expect(parseCookie("session=%", "session")).toBeNull();
  });
});

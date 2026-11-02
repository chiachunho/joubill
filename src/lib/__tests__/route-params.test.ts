import { describe, expect, it } from "vitest";

import { BadRequestError } from "@/lib/auth/errors";
import { MAX_ID, parseId, requireId } from "@/lib/route-params";

describe("parseId", () => {
  it("reads plain positive integers", () => {
    expect(parseId("1")).toBe(1);
    expect(parseId("42")).toBe(42);
    expect(parseId(String(MAX_ID))).toBe(MAX_ID);
  });

  it.each([
    ["missing", null],
    ["undefined", undefined],
    ["empty", ""],
    ["whitespace", " "],
    ["padded", " 1"],
    ["zero", "0"],
    ["leading zero", "01"],
    ["negative", "-1"],
    ["decimal", "1.5"],
    ["exponent", "1e3"],
    ["hex", "0x10"],
    ["word", "abc"],
    ["past int4", String(MAX_ID + 1)],
    ["eleven digits", "12345678901"],
  ])("rejects %s", (_, raw) => {
    expect(parseId(raw)).toBeNull();
  });
});

describe("requireId", () => {
  it("returns the id", () => {
    expect(requireId("7", "group id")).toBe(7);
  });

  it("throws a 400 naming the parameter", () => {
    let err: unknown;
    try {
      requireId("1.5", "group id");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(BadRequestError);
    expect(err).toMatchObject({ status: 400, message: "invalid group id" });
  });

  it("defaults the label to id", () => {
    expect(() => requireId("x")).toThrow("invalid id");
  });
});

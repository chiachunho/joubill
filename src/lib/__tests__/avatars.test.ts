import { afterEach, describe, expect, it, vi } from "vitest";

import { TtlCache } from "@/lib/avatars";

afterEach(() => {
  vi.useRealTimers();
});

describe("TtlCache", () => {
  it("serves an entry until it expires, including a cached null", () => {
    vi.useFakeTimers();
    const cache = new TtlCache<number, string | null>(1000);
    cache.set(1, null);
    expect(cache.get(1)).toBeNull();
    vi.advanceTimersByTime(1001);
    expect(cache.get(1)).toBeUndefined();
  });

  it("sweeps expired entries before evicting live ones when full", () => {
    vi.useFakeTimers();
    const cache = new TtlCache<number, string>(1000, 3);
    cache.set(1, "a");
    cache.set(2, "b");
    vi.advanceTimersByTime(1001);
    cache.set(3, "c");
    cache.set(4, "d");
    expect(cache.size).toBe(2);
    expect(cache.get(3)).toBe("c");
  });

  it("drops the oldest live entry once full", () => {
    const cache = new TtlCache<number, string>(60_000, 2);
    cache.set(1, "a");
    cache.set(2, "b");
    cache.set(3, "c");
    expect(cache.size).toBe(2);
    expect(cache.get(1)).toBeUndefined();
    expect(cache.get(3)).toBe("c");
  });
});

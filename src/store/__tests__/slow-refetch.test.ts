import { describe, expect, it, vi } from "vitest";

import { SLOW_REFETCH_SECONDS, withSlowRefetch } from "../slow-refetch";

describe("withSlowRefetch", () => {
  it("asks the hook not to refetch a copy younger than the slow window", () => {
    const hook = vi.fn().mockReturnValue("result");
    const wrapped = withSlowRefetch(hook);

    expect(wrapped(7)).toBe("result");
    expect(hook).toHaveBeenCalledWith(7, { refetchOnMountOrArgChange: SLOW_REFETCH_SECONDS });
  });

  it("passes the caller's other options along, and lets its own refetch setting win", () => {
    const hook = vi.fn();
    const wrapped = withSlowRefetch(hook);

    wrapped(7, { skip: true });
    expect(hook).toHaveBeenLastCalledWith(7, {
      refetchOnMountOrArgChange: SLOW_REFETCH_SECONDS,
      skip: true,
    });

    wrapped(7, { refetchOnMountOrArgChange: true });
    expect(hook).toHaveBeenLastCalledWith(7, { refetchOnMountOrArgChange: true });
  });
});

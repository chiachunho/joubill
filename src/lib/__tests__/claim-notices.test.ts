import { describe, expect, it } from "vitest";

import { CLAIM_NOTICE_LIMIT, noticesToRefresh } from "../claim-notices";

describe("noticesToRefresh", () => {
  it("takes the newest records first", () => {
    expect(noticesToRefresh([3, 9, 5])).toEqual([9, 5, 3]);
  });

  it("skips records that were deleted by the merge", () => {
    expect(noticesToRefresh([1, 2, 3], [2])).toEqual([3, 1]);
  });

  it("stays under the chat's rate limit", () => {
    const many = Array.from({ length: 100 }, (_, i) => i + 1);
    const picked = noticesToRefresh(many);
    expect(picked).toHaveLength(CLAIM_NOTICE_LIMIT);
    expect(picked[0]).toBe(100);
  });
});

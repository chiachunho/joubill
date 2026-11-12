import { describe, expect, it } from "vitest";

import { imageWarningAdvice, imageWarnings, LOW_RES_LONG_EDGE } from "@/lib/mcp/receipt-images";

/** The smallest PNG header that says its size: signature, then IHDR's length, name, width, height. */
function png(width: number, height: number): Uint8Array {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
  b.set(new TextEncoder().encode("IHDR"), 12);
  new DataView(b.buffer).setUint32(16, width);
  new DataView(b.buffer).setUint32(20, height);
  return b;
}

describe("imageWarnings (issue #163)", () => {
  it("flags a photo shrunk to fit into base64, by its position in images", () => {
    expect(imageWarnings([png(3024, 4032), png(480, 640)])).toEqual([
      { code: "low_resolution", image: 1, width: 480, height: 640 },
    ]);
  });

  it("goes by the long edge, so a tall narrow receipt isn't flagged", () => {
    expect(imageWarnings([png(600, LOW_RES_LONG_EDGE)])).toEqual([]);
    expect(imageWarnings([png(LOW_RES_LONG_EDGE - 1, 300)])).toHaveLength(1);
  });

  it("doesn't flag an image whose size can't be read", () => {
    expect(imageWarnings([png(100, 100).subarray(0, 12)])).toEqual([]);
  });

  it("tells the agent not to shrink, and which link to give", () => {
    expect(imageWarningAdvice(true)).toMatch(/Never crop, shrink/);
    expect(imageWarningAdvice(true)).toMatch(/give the user uploadUrl/);
    expect(imageWarningAdvice(false)).toMatch(/record the expense without images/);
  });
});

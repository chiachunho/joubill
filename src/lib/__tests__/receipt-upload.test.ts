import { describe, expect, it } from "vitest";

import { sniffImage } from "@/lib/receipt-upload";

const bytes = (...v: number[]) => new Uint8Array(v);

describe("sniffImage", () => {
  it("recognises jpeg, png and webp by their first bytes", () => {
    expect(sniffImage(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(sniffImage(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe("image/png");
    const webp = new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 ");
    expect(sniffImage(webp)).toBe("image/webp");
  });

  it("refuses everything else, whatever it claims to be", () => {
    expect(
      sniffImage(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>")),
    ).toBeNull();
    expect(sniffImage(new TextEncoder().encode("GIF89a......"))).toBeNull();
    expect(sniffImage(new TextEncoder().encode("RIFF\0\0\0\0WAVEfmt "))).toBeNull();
    expect(sniffImage(bytes())).toBeNull();
  });
});

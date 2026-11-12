import type { ReceiptMime } from "@/lib/receipt-upload";

export type ImageSize = { width: number; height: number };

/**
 * Pixel size of a jpeg, png or webp, read from its header. Null when the header can't be read;
 * callers treat that as "unknown", never as small. Pure: no decoder, only the bytes that say
 * the size.
 */
export function imageSize(b: Uint8Array, mime: ReceiptMime): ImageSize | null {
  switch (mime) {
    case "image/png":
      return pngSize(b);
    case "image/jpeg":
      return jpegSize(b);
    case "image/webp":
      return webpSize(b);
  }
}

function sized(width: number, height: number): ImageSize | null {
  return width > 0 && height > 0 ? { width, height } : null;
}

const u16be = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const u32be = (b: Uint8Array, i: number) =>
  ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
const u16le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const u24le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);

/** IHDR is always the first chunk: width and height follow the 8-byte signature and its header. */
function pngSize(b: Uint8Array): ImageSize | null {
  if (b.length < 24) return null;
  if (String.fromCharCode(...b.subarray(12, 16)) !== "IHDR") return null;
  return sized(u32be(b, 16), u32be(b, 20));
}

/** Start-of-frame markers; C4 (DHT), C8 (JPG) and CC (DAC) share the range but aren't frames. */
const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

/** Walks the segments to the first start-of-frame, which holds the size. */
function jpegSize(b: Uint8Array): ImageSize | null {
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    if (marker === 0xff) {
      i += 1; // fill byte
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      i += 2; // no length
      continue;
    }
    const length = u16be(b, i + 2);
    if (length < 2) return null;
    if (SOF.has(marker)) {
      if (i + 9 > b.length) return null;
      return sized(u16be(b, i + 7), u16be(b, i + 5));
    }
    i += 2 + length;
  }
  return null;
}

/** The first chunk after `RIFF....WEBP` is one of the three formats, each with its own layout. */
function webpSize(b: Uint8Array): ImageSize | null {
  if (b.length < 30) return null;
  const chunk = String.fromCharCode(...b.subarray(12, 16));
  if (chunk === "VP8 ") {
    return sized(u16le(b, 26) & 0x3fff, u16le(b, 28) & 0x3fff);
  }
  if (chunk === "VP8L") {
    if (b[20] !== 0x2f) return null;
    const width = 1 + (((b[22] & 0x3f) << 8) | b[21]);
    const height = 1 + (((b[24] & 0x0f) << 10) | (b[23] << 2) | ((b[22] & 0xc0) >> 6));
    return sized(width, height);
  }
  if (chunk === "VP8X") {
    return sized(1 + u24le(b, 24), 1 + u24le(b, 27));
  }
  return null;
}

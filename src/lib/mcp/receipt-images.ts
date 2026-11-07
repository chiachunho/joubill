import { z } from "zod";

import type { McpAuth } from "@/lib/auth/mcp";
import { enforceMcpRateLimit } from "@/lib/rate-limit";
import { fetchReceiptImage, ReceiptFetchError } from "@/lib/receipt-fetch";
import {
  MAX_RECEIPT_BYTES,
  MAX_RECEIPTS,
  ReceiptUploadError,
  sniffImage,
  uploadReceiptPhoto,
} from "@/lib/receipt-upload";

import { ToolError } from "./result";

/** Base64 of 10 MB is ~13.4 M characters. */
const MAX_BASE64_CHARS = Math.ceil((MAX_RECEIPT_BYTES * 4) / 3) + 4;

export const imageSchema = z.union([
  z.object({
    base64: z
      .string()
      .min(16)
      .max(MAX_BASE64_CHARS)
      .describe("Image bytes, base64 (a data: URL prefix is fine)."),
  }),
  z.object({
    url: z
      .string()
      .trim()
      .min(8)
      .max(2048)
      .describe("Public https link to the image. Redirects are not followed."),
  }),
]);

export type ImageArg = z.infer<typeof imageSchema>;

/** The bytes of one image argument, checked to be a jpeg, png or webp. */
export async function loadImage(arg: ImageArg, index: number): Promise<Uint8Array> {
  const label = `images[${index}]`;
  let bytes: Uint8Array;
  try {
    if ("url" in arg) {
      bytes = await fetchReceiptImage(arg.url);
    } else {
      const raw = arg.base64.replace(/^data:[^,]*;base64,/, "").replace(/\s+/g, "");
      if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(raw)) {
        throw new ToolError("bad_request", `${label} is not valid base64`);
      }
      bytes = new Uint8Array(Buffer.from(raw, "base64"));
    }
  } catch (err) {
    if (err instanceof ReceiptFetchError) {
      throw new ToolError("bad_request", `${label}: ${err.message}`);
    }
    throw err;
  }
  if (bytes.length > MAX_RECEIPT_BYTES) {
    throw new ToolError("bad_request", `${label} is larger than 10 MB`);
  }
  if (!sniffImage(bytes)) {
    throw new ToolError("bad_request", `${label} is not a jpeg, png or webp image`);
  }
  return bytes;
}

/** Validates every image argument; nothing is uploaded, so a bad one stops the whole call. */
export const loadImages = (args: ImageArg[]) => Promise.all(args.map((a, i) => loadImage(a, i)));

/**
 * Uploads already-validated images and returns their file ids. The call itself was counted
 * once; each further image is another write. A failure stores nothing the record can use.
 */
export async function uploadImages(auth: McpAuth, images: Uint8Array[]): Promise<string[]> {
  for (let i = 1; i < images.length; i++) {
    await enforceMcpRateLimit(auth.grant.connectionId, "write");
  }
  const fileIds: string[] = [];
  try {
    for (const [i, bytes] of images.entries()) {
      fileIds.push(
        await uploadReceiptPhoto(bytes, sniffImage(bytes) ?? "image/jpeg", `receipt-${i + 1}`),
      );
    }
  } catch (err) {
    if (err instanceof ReceiptUploadError) {
      throw new ToolError("internal", "the photo could not be stored; nothing was recorded");
    }
    throw err;
  }
  return fileIds;
}

export const imagesSchema = z.array(imageSchema).min(1).max(MAX_RECEIPTS);
